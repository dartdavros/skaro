<script lang="ts">
  import ProjectSection from './ProjectSection.svelte';
  import ProjectNavigation from './ProjectNavigation.svelte';
  import { onDestroy } from 'svelte';
  import type { ProjectInfo } from '../../../shared/ipc';
  import { agents } from '../agents.svelte';
  import { ProjectTasks } from '../tasks/data.svelte';
  import '../tasks/i18n';
  import ImportModal from '../import/ImportModal.svelte';
  import LimitsModal from '../limits/LimitsModal.svelte';

  /** A project tab: the sections panel on the left and the current section beside it. */
  let {
    project,
    section = $bindable('tasks'),
    task = $bindable(),
    chat = $bindable(),
    collapsed = $bindable(false),
    onremove,
    onchanged,
  }: {
    project: ProjectInfo;
    section?: string;
    /** Open task of the "Задачи" section. */
    task?: string | undefined;
    /** Open chat of the "Чат" section. */
    chat?: string | undefined;
    collapsed?: boolean;
    /** "Убрать проект": the project left Skaro. */
    onremove: () => void;
    /** The name or the logo changed in "Параметры проекта". */
    onchanged: () => void;
  } = $props();

  /** A document to open when "Документы" shows next (a task's specification). */
  let doc = $state<string | undefined>();
  let limitsOpen = $state(false);
  let graphTarget = $state<{ elementId: string; viewId?: string }>();
  let c4Target = $state<{ viewId: string; elementId?: string }>();
  let requestedDiagram = $state<'graph' | 'c4'>();
  let leaveSection: ((proceed: () => void) => void) | undefined;

  $effect(() =>
    window.skaro.on('window.hidden', () => {
      requestedDiagram = undefined;
      graphTarget = undefined;
      c4Target = undefined;
    }),
  );

  function openDoc(path: string): void {
    doc = path;
    section = 'docs';
  }

  /** "Импортировать документацию" is open (ImportModal). */
  let importing = $state(false);

  /** The start screen of a new chat (ChatScreen). */
  const NEW_CHAT = 'new';

  // The component is keyed by project.
  // svelte-ignore state_referenced_locally
  const data = new ProjectTasks(project.id);
  onDestroy(() => data.dispose());

  const current = $derived(
    section === requestedDiagram || ['tasks', 'docs', 'plan', 'chat', 'params'].includes(section)
      ? section
      : 'tasks',
  );

  /** The open task names a milestone: it is the screen of a stage, shown under "План". */
  const stageOpen = $derived(task !== undefined && data.milestones.some((m) => m.id === task));

  function go(id: string): void {
    const proceed = () => {
      if (id === 'tasks' || stageOpen) task = undefined;
      requestedDiagram = id === 'graph' || id === 'c4' ? id : undefined;
      section = id;
    };
    if (section === 'docs' && leaveSection && id !== section) leaveSection(proceed);
    else proceed();
  }

  /** Opens a task, or the stage of a milestone. */
  function openTask(id: string): void {
    const milestone = data.milestones.some((m) => m.id === id);
    task = milestone ? undefined : id;
    section = milestone ? 'plan' : 'tasks';
  }

  /** Tasks and plans are made with the agent, in a new chat ("Новая задача", "Перепланировать"). */
  function newChat(): void {
    chat = NEW_CHAT;
    section = 'chat';
  }
</script>

<div class="project">
  <ProjectNavigation
    {project}
    {data}
    section={current}
    bind:collapsed
    ontask={openTask}
    onlimits={() => (limitsOpen = true)}
    onselect={(id) => {
      graphTarget = undefined;
      c4Target = undefined;
      go(id);
    }}
  />
  <ProjectSection
    {project}
    section={current}
    {task}
    stage={stageOpen}
    bind:chat
    {doc}
    {data}
    {graphTarget}
    bind:c4Target
    onleave={(guard) => (leaveSection = guard)}
    ongraph={(elementId, viewId) => {
      graphTarget = { elementId, viewId };
      go('graph');
    }}
    onc4={(viewId, elementId) => {
      c4Target = { viewId, ...(elementId ? { elementId } : {}) };
      go('c4');
    }}
    agents={agents.list}
    ontasks={() => (task = undefined)}
    {openDoc}
    {newChat}
    {go}
    {openTask}
    {onremove}
    {onchanged}
    onimport={() => (importing = true)}
  />
</div>

{#if limitsOpen}
  <LimitsModal projectId={project.id} agents={agents.list} bind:open={limitsOpen} />
{/if}

{#if importing}
  <ImportModal
    projectId={project.id}
    agents={agents.list}
    onclose={() => (importing = false)}
    onstart={(started) => {
      importing = false;
      chat = started.id;
      section = 'chat';
    }}
  />
{/if}

<style>
  .project {
    flex: 1;
    min-height: 0;
    display: flex;
  }
</style>
