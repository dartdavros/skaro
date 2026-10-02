<script lang="ts">
  import ProjectSection from './ProjectSection.svelte';
  import { NavPanel, t, tn, type NavItem } from '@skaro/ui';
  import { onDestroy } from 'svelte';
  import type { ProjectInfo } from '../../../shared/ipc';
  import { agents } from '../agents.svelte';
  import { ProjectTasks } from '../tasks/data.svelte';
  import '../tasks/i18n';
  import { needsYou } from '../tasks/model';
  import ImportModal from '../import/ImportModal.svelte';
  import { NavigationWidth } from './navigation-width.svelte';

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
  const navigation = new NavigationWidth();
  onDestroy(() => navigation.dispose());

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
  <NavPanel
    title={project.name}
    logo={project.logo}
    {items}
    active={current.id}
    bind:collapsed
    bind:width={navigation.width}
    onresize={() => navigation.save()}
    onselect={(id) => {
      if (id === 'tasks' && section === 'tasks') task = undefined;
      section = id;
    }}
  />
  <ProjectSection
    {project}
    section={current.id}
    {task}
    bind:chat
    {doc}
    {data}
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
