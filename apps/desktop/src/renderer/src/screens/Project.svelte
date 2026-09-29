<script lang="ts">
  import { NavPanel, t, tn, type NavItem } from '@skaro/ui';
  import { onDestroy } from 'svelte';
  import type { ProjectInfo } from '../../../shared/ipc';
  import { agents } from '../agents.svelte';
  import ChatScreen from '../chat/ChatScreen.svelte';
  import DocsScreen from '../docs/DocsScreen.svelte';
  import PlanScreen from '../plan/PlanScreen.svelte';
  import TaskScreen from '../task/TaskScreen.svelte';
  import { ProjectTasks } from '../tasks/data.svelte';
  import '../tasks/i18n';
  import { needsYou } from '../tasks/model';
  import TasksScreen from '../tasks/TasksScreen.svelte';
  import ProjectParams from '../params/ProjectParams.svelte';
  import ImportModal from '../import/ImportModal.svelte';

  /** A project tab: the section on the left, the sections panel on the right. */
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

  const attention = $derived(data.tasks.filter((x) => !x.archived && needsYou(x)).length);

  const items = $derived<NavItem[]>([
    {
      id: 'tasks',
      label: t('nav.tasks'),
      tip: t('nav.tasks.tip'),
      icon: 'tasks',
      count: attention,
      countTip: t('board.attention.tip'),
      railTip: tn('board.attention.rail', attention),
    },
    { id: 'docs', label: t('nav.docs'), tip: t('nav.docs.tip'), icon: 'docs' },
    { id: 'plan', label: t('nav.plan'), tip: t('nav.plan.tip'), icon: 'plan' },
    { id: 'chat', label: t('nav.chat'), tip: t('nav.chat.tip'), icon: 'chat', separated: true },
    { id: 'params', label: t('nav.params'), tip: t('nav.params.tip'), icon: 'params' },
  ]);
  const current = $derived(items.find((i) => i.id === section) ?? items[0]!);

  function go(id: string): void {
    if (id === 'tasks') task = undefined;
    section = id;
  }

  function openTask(id: string): void {
    task = id;
    section = 'tasks';
  }

  /** Tasks and plans are made with the agent, in a new chat ("Новая задача", "Перепланировать"). */
  function newChat(): void {
    chat = NEW_CHAT;
    section = 'chat';
  }
</script>

<div class="project">
  {#if current.id === 'tasks' && task}
    {#key task}
      <TaskScreen
        projectId={project.id}
        taskId={task}
        agents={agents.list}
        ontasks={() => (task = undefined)}
        onspec={openDoc}
      />
    {/key}
  {:else if current.id === 'docs'}
    <DocsScreen
      projectId={project.id}
      open={doc}
      tasks={data}
      onchat={newChat}
      ontask={openTask}
      onimport={() => (importing = true)}
    />
  {:else if current.id === 'plan'}
    <PlanScreen projectId={project.id} {data} onopen={openTask} onchat={newChat} />
  {:else if current.id === 'params'}
    <ProjectParams {project} {onremove} {onchanged} />
  {:else if current.id === 'chat'}
    {#key project.id}
      <ChatScreen
        {project}
        agents={agents.list}
        bind:chat
        onsection={go}
        onimport={() => (importing = true)}
      />
    {/key}
  {:else}
    <TasksScreen projectId={project.id} {data} onopen={openTask} onnew={newChat} />
  {/if}
  <NavPanel
    title={project.name}
    logo={project.logo}
    {items}
    active={current.id}
    bind:collapsed
    onselect={(id) => {
      if (id === 'tasks' && section === 'tasks') task = undefined;
      section = id;
    }}
  />
</div>

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
