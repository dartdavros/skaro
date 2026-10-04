<script lang="ts">
  import { TooltipHost } from '@skaro/ui';
  import { agents } from './agents.svelte';
  import Home from './screens/Home.svelte';
  import NewProjectModal from './screens/NewProjectModal.svelte';
  import Inventory from './screens/Inventory.svelte';
  import Project from './screens/Project.svelte';
  import Settings from './screens/Settings.svelte';
  import TitleBar from './TitleBar.svelte';
  import UpdatesModal from './updates/UpdatesModal.svelte';
  import { createNavigation } from './app-navigation.svelte';
  const nav = createNavigation();
</script>

<TooltipHost />
<UpdatesModal />
<NewProjectModal bind:open={nav.newProject} oncreated={(p) => void nav.projectAdded(p)} />

<div class="app">
  <TitleBar
    locked={agents.none}
    tabs={nav.projectTabs}
    active={nav.view === 'project' ? nav.tabs.active : undefined}
    home={nav.view === 'home'}
    settings={nav.view === 'settings' || nav.view === 'inventory'}
    onhome={nav.goHome}
    onselect={nav.openProject}
    onclose={nav.closeTab}
    onadd={nav.addProject}
    onsettings={() => (nav.view = 'settings')}
  />
  {#if nav.loaded}
    {#if nav.view === 'project' && nav.activeProject}
      {@const activeProject = nav.activeProject}
      {#key activeProject.id}
        <Project
          project={activeProject}
          bind:section={
            () => nav.sections[activeProject.id] ?? 'tasks',
            (v) => (nav.sections[activeProject.id] = v)
          }
          bind:task={
            () => nav.openTasks[activeProject.id], (v) => (nav.openTasks[activeProject.id] = v)
          }
          bind:chat={
            () => nav.openChats[activeProject.id], (v) => (nav.openChats[activeProject.id] = v)
          }
          bind:collapsed={nav.panelCollapsed}
          onremove={() => void nav.projectRemoved(activeProject.id)}
          onchanged={() => void nav.refreshProjects()}
        />
      {/key}
    {:else if nav.view === 'settings'}
      <Settings noAgents={agents.none} />
    {:else}
      <main class="page">
        {#if nav.view === 'inventory'}
          <Inventory />
        {:else}
          <Home
            projects={nav.projects}
            onopen={nav.openProject}
            onadd={nav.addProject}
            onsettings={() => (nav.view = 'settings')}
            onchanged={() => void nav.refreshProjects()}
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
