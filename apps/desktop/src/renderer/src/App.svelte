<script lang="ts">
  import { TooltipHost, type ProjectTab } from '@skaro/ui';
  import type { ProjectInfo, TabsState } from '../../shared/ipc';
  import { agents, watchAgents } from './agents.svelte';
  import Home from './screens/Home.svelte';
  import NewProjectModal from './screens/NewProjectModal.svelte';
  import Inventory from './screens/Inventory.svelte';
  import Project from './screens/Project.svelte';
  import Settings from './screens/Settings.svelte';
  import { applyFeedFont } from './settings/setting.svelte';
  import { tabStates, watchTabStates } from './tab-states.svelte';
  import TitleBar from './TitleBar.svelte';

  type View = 'home' | 'project' | 'settings' | 'inventory';

  let projects = $state<ProjectInfo[]>([]);
  let tabs = $state<TabsState>({ projects: [] });
  let view = $state<View>('home');
  let loaded = $state(false);
  /** Selected section per project; the panel state is shared by all projects. */
  let sections = $state<Record<string, string>>({});
  /** Open task per project ("Задачи" section). */
  let openTasks = $state<Record<string, string | undefined>>({});
  /** Open chat per project ("Чат" section). */
  let openChats = $state<Record<string, string | undefined>>({});
  let panelCollapsed = $state(false);

  const projectTabs = $derived<ProjectTab[]>(
    tabs.projects
      .map((id) => projects.find((p) => p.id === id))
      .filter((p): p is ProjectInfo => p !== undefined)
      .map((p) => ({ id: p.id, label: p.name, state: tabStates.byProject[p.id] ?? 'none' })),
  );
  const activeProject = $derived(
    view === 'project' ? projects.find((p) => p.id === tabs.active) : undefined,
  );

  watchAgents();
  watchTabStates();

  // Without a ready agent there is nothing Skaro can do: only "Настройки" → "Агенты" is open.
  $effect(() => {
    if (agents.none && view !== 'settings' && view !== 'inventory') view = 'settings';
  });

  $effect(() => {
    void (async () => {
      projects = await window.skaro.invoke('projects.list');
      tabs = await window.skaro.invoke('tabs.get');
      // The UI inventory (all elements for checking against the mockups) opens with ?inventory.
      view = new URLSearchParams(location.search).has('inventory')
        ? 'inventory'
        : tabs.active
          ? 'project'
          : 'home';
      applyFeedFont((await window.skaro.invoke('app.getSetting', 'ui.feedFont')) as string | null);
      panelCollapsed = (await window.skaro.invoke('app.getSetting', 'ui.navCollapsed')) === true;
      loaded = true;
    })();
  });

  // Open tabs survive restarts (plan: stage 4).
  $effect(() => {
    if (!loaded) return;
    void window.skaro.invoke('tabs.set', $state.snapshot(tabs));
  });

  $effect(() => {
    if (loaded) void window.skaro.invoke('app.setSetting', 'ui.navCollapsed', panelCollapsed);
  });

  function openProject(id: string): void {
    tabs = {
      projects: tabs.projects.includes(id) ? tabs.projects : [...tabs.projects, id],
      active: id,
    };
    view = 'project';
  }

  function closeTab(id: string): void {
    const index = tabs.projects.indexOf(id);
    const rest = tabs.projects.filter((p) => p !== id);
    if (tabs.active !== id) {
      tabs = { ...tabs, projects: rest };
      return;
    }
    const next = rest[Math.min(index, rest.length - 1)];
    tabs = next ? { projects: rest, active: next } : { projects: rest };
    view = next ? 'project' : 'home';
  }

  function goHome(): void {
    tabs = { projects: tabs.projects };
    view = 'home';
  }

  let newProject = $state(false);

  function addProject(): void {
    newProject = true;
  }

  async function projectRemoved(id: string): Promise<void> {
    closeTab(id);
    projects = await window.skaro.invoke('projects.list');
  }

  async function projectAdded(project: ProjectInfo): Promise<void> {
    projects = await window.skaro.invoke('projects.list');
    openProject(project.id);
  }
</script>

<TooltipHost />
<NewProjectModal bind:open={newProject} oncreated={(p) => void projectAdded(p)} />

<div class="app">
  <TitleBar
    locked={agents.none}
    tabs={projectTabs}
    active={view === 'project' ? tabs.active : undefined}
    home={view === 'home'}
    settings={view === 'settings' || view === 'inventory'}
    onhome={goHome}
    onselect={openProject}
    onclose={closeTab}
    onadd={addProject}
    onsettings={() => (view = 'settings')}
  />
  {#if loaded}
    {#if view === 'project' && activeProject}
      {#key activeProject.id}
        <Project
          project={activeProject}
          bind:section={
            () => sections[activeProject.id] ?? 'tasks', (v) => (sections[activeProject.id] = v)
          }
          bind:task={() => openTasks[activeProject.id], (v) => (openTasks[activeProject.id] = v)}
          bind:chat={() => openChats[activeProject.id], (v) => (openChats[activeProject.id] = v)}
          bind:collapsed={panelCollapsed}
          onremove={() => void projectRemoved(activeProject.id)}
          onchanged={() =>
            void window.skaro.invoke('projects.list').then((list) => (projects = list))}
        />
      {/key}
    {:else if view === 'settings'}
      <Settings noAgents={agents.none} />
    {:else}
      <main class="page">
        {#if view === 'inventory'}
          <Inventory />
        {:else}
          <Home
            {projects}
            onopen={openProject}
            onadd={addProject}
            onsettings={() => (view = 'settings')}
            onchanged={() =>
              void window.skaro.invoke('projects.list').then((list) => (projects = list))}
          />
        {/if}
      </main>
    {/if}
  {/if}
</div>

<style>
  .app {
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--sk-topbar);
    overflow: hidden;
  }

  .page {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 22px 26px 28px;
    background: var(--sk-bg);
  }
</style>
