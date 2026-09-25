<script lang="ts">
  import { TooltipHost, type ProjectTab } from '@skaro/ui';
  import type { ProjectInfo, TabsState } from '../../shared/ipc';
  import { watchAgents } from './agents.svelte';
  import Home from './screens/Home.svelte';
  import Inventory from './screens/Inventory.svelte';
  import Project from './screens/Project.svelte';
  import Settings from './screens/Settings.svelte';
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
  let panelCollapsed = $state(false);

  const projectTabs = $derived<ProjectTab[]>(
    tabs.projects
      .map((id) => projects.find((p) => p.id === id))
      .filter((p): p is ProjectInfo => p !== undefined)
      .map((p) => ({ id: p.id, label: p.name })),
  );
  const activeProject = $derived(
    view === 'project' ? projects.find((p) => p.id === tabs.active) : undefined,
  );

  watchAgents();

  $effect(() => {
    void (async () => {
      projects = await window.skaro.invoke('projects.list');
      tabs = await window.skaro.invoke('tabs.get');
      view = tabs.active ? 'project' : 'home';
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

  async function addProject(): Promise<void> {
    const project = await window.skaro.invoke('projects.add');
    if (!project) return;
    projects = await window.skaro.invoke('projects.list');
    openProject(project.id);
  }
</script>

<TooltipHost />

<div class="app">
  <TitleBar
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
            () => sections[activeProject.id] ?? 'overview', (v) => (sections[activeProject.id] = v)
          }
          bind:task={() => openTasks[activeProject.id], (v) => (openTasks[activeProject.id] = v)}
          bind:collapsed={panelCollapsed}
        />
      {/key}
    {:else}
      <main class="page">
        {#if view === 'settings'}
          <Settings oninventory={() => (view = 'inventory')} />
        {:else if view === 'inventory'}
          <Inventory />
        {:else}
          <Home {projects} onopen={openProject} onadd={addProject} />
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
