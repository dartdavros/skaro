<script lang="ts">
  import { NavPanel, t, type NavItem } from '@skaro/ui';
  import type { ProjectInfo } from '../../../shared/ipc';
  import { agents } from '../agents.svelte';
  import TaskScreen from '../task/TaskScreen.svelte';
  import Placeholder from './Placeholder.svelte';
  import Tasks from './Tasks.svelte';

  /** A project tab: the section on the left, the sections panel on the right. */
  let {
    project,
    section = $bindable('overview'),
    task = $bindable(),
    collapsed = $bindable(false),
  }: {
    project: ProjectInfo;
    section?: string;
    /** Open task of the "Задачи" section. */
    task?: string | undefined;
    collapsed?: boolean;
  } = $props();

  // Stage of the implementation plan where each screen arrives.
  const stages: Record<string, number> = {
    overview: 7,
    docs: 7,
    plan: 7,
    tasks: 7,
    chat: 6,
    params: 7,
  };

  const items = $derived<NavItem[]>([
    { id: 'overview', label: t('nav.overview'), tip: t('nav.overview.tip'), icon: 'overview' },
    { id: 'docs', label: t('nav.docs'), tip: t('nav.docs.tip'), icon: 'docs' },
    { id: 'plan', label: t('nav.plan'), tip: t('nav.plan.tip'), icon: 'plan' },
    { id: 'tasks', label: t('nav.tasks'), tip: t('nav.tasks.tip'), icon: 'tasks' },
    { id: 'chat', label: t('nav.chat'), tip: t('nav.chat.tip'), icon: 'chat', separated: true },
    { id: 'params', label: t('nav.params'), tip: t('nav.params.tip'), icon: 'params' },
  ]);
  const current = $derived(items.find((i) => i.id === section) ?? items[0]!);
</script>

<div class="project">
  {#if current.id === 'tasks' && task}
    {#key task}
      <TaskScreen
        projectId={project.id}
        taskId={task}
        agents={agents.list}
        ontasks={() => (task = undefined)}
      />
    {/key}
  {:else}
    <main class="content">
      {#if current.id === 'tasks'}
        <Tasks projectId={project.id} onopen={(id) => (task = id)} />
      {:else}
        <Placeholder title={`${project.name} · ${current.label}`} stage={stages[current.id] ?? 7} />
      {/if}
    </main>
  {/if}
  <NavPanel
    title={project.name}
    {items}
    active={current.id}
    bind:collapsed
    onselect={(id) => {
      if (id === 'tasks' && section === 'tasks') task = undefined;
      section = id;
    }}
  />
</div>

<style>
  .project {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .content {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 22px 26px 28px;
    background: var(--sk-bg);
  }
</style>
