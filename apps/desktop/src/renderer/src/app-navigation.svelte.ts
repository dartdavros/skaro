import type { ProjectTab } from '@skaro/ui';
import type { ProjectInfo, TabsState } from '../../shared/ipc';
import { agents, watchAgents } from './agents.svelte';
import { applyFeedFont } from './settings/setting.svelte';
import { tabStates, watchTabStates } from './tab-states.svelte';
import { SvelteURLSearchParams } from 'svelte/reactivity';

type View = 'home' | 'project' | 'settings' | 'inventory';

/** Navigation and persisted tabs; views remain composition-only. */
export function createNavigation() {
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
      view = new SvelteURLSearchParams(location.search).has('inventory')
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

  return {
    get projects() {
      return projects;
    },
    set projects(value: typeof projects) {
      projects = value;
    },
    get tabs() {
      return tabs;
    },
    set tabs(value: typeof tabs) {
      tabs = value;
    },
    get view() {
      return view;
    },
    set view(value: typeof view) {
      view = value;
    },
    get loaded() {
      return loaded;
    },
    set loaded(value: typeof loaded) {
      loaded = value;
    },
    get sections() {
      return sections;
    },
    set sections(value: typeof sections) {
      sections = value;
    },
    get openTasks() {
      return openTasks;
    },
    set openTasks(value: typeof openTasks) {
      openTasks = value;
    },
    get openChats() {
      return openChats;
    },
    set openChats(value: typeof openChats) {
      openChats = value;
    },
    get panelCollapsed() {
      return panelCollapsed;
    },
    set panelCollapsed(value: typeof panelCollapsed) {
      panelCollapsed = value;
    },
    get newProject() {
      return newProject;
    },
    set newProject(value: typeof newProject) {
      newProject = value;
    },
    get projectTabs() {
      return projectTabs;
    },
    get activeProject() {
      return activeProject;
    },
    openProject,
    closeTab,
    goHome,
    addProject,
    projectRemoved,
    projectAdded,
    refreshProjects: async () => {
      projects = await window.skaro.invoke('projects.list');
    },
  };
}
