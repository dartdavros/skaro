<script lang="ts">
  import { i18n, NavPanel, t, tn, type NavItem, type NavTask } from '@skaro/ui';
  import { onDestroy, type Snippet } from 'svelte';
  import type { ProjectInfo } from '../../../shared/ipc';
  import type { ProjectTasks } from '../tasks/data.svelte';
  import { statusLabel } from '../tasks/model';
  import { activeKind } from '../../../shared/task-presentation';
  import type { TaskSummary } from '../../../shared/ipc';
  import WindowedContent from '../WindowedContent.svelte';
  import '../limits/i18n';
  import { NavigationWidth } from './navigation-width.svelte';
  import { ProjectLimits } from '../limits/project-limits.svelte';
  import { lowPercentLabel } from '../limits/low-remaining';
  import ProjectLimitNav from '../limits/ProjectLimitNav.svelte';
  import ActivityMark from '../activity/ActivityMark.svelte';
  let {
    project,
    data,
    section,
    collapsed = $bindable(false),
    onselect,
    ontask,
    onlimits,
  }: {
    project: ProjectInfo;
    data: ProjectTasks;
    section: string;
    collapsed?: boolean;
    onselect: (id: string) => void;
    ontask: (id: string) => void;
    onlimits: () => void;
  } = $props();
  const navigation = new NavigationWidth();
  onDestroy(() => navigation.dispose());
  // The navigation is mounted for the current project only.
  // svelte-ignore state_referenced_locally
  const limits = new ProjectLimits(project.id);
  onDestroy(() => limits.dispose());
  const limitPercent = $derived(
    limits.remaining === undefined ? undefined : lowPercentLabel(limits.remaining, i18n.locale),
  );
  const attention = $derived(data.catalog?.facets.attention ?? 0);
  const stagesWaiting = $derived(
    data.stages.filter((s) =>
      ['acceptance_needs_answer', 'awaiting_merge', 'error'].includes(s.state),
    ).length,
  );
  const items = $derived<NavItem[]>([
    { id: 'docs', label: t('nav.docs'), tip: t('nav.docs.tip'), icon: 'docs' },
    { id: 'c4', label: 'C4', tip: t('nav.c4.tip'), icon: 'layers' },
    { id: 'graph', label: t('nav.graph'), tip: t('nav.graph.tip'), icon: 'network' },
    {
      id: 'plan',
      label: t('nav.plan'),
      tip: t('nav.plan.tip'),
      icon: 'plan',
      count: stagesWaiting,
      countTip: t('plan.attention.tip'),
      railTip: tn('plan.attention.rail', stagesWaiting),
    },
    {
      id: 'tasks',
      label: t('nav.tasks'),
      tip: t('nav.tasks.tip'),
      icon: 'tasks',
      count: attention,
      countTip: t('board.attention.tip'),
      railTip: tn('board.attention.rail', attention),
    },
    { id: 'chat', label: t('nav.chat'), tip: t('nav.chat.tip'), icon: 'chat', separated: true },
    { id: 'params', label: t('nav.params'), tip: t('nav.params.tip'), icon: 'params' },
  ]);
  function navTask(task: TaskSummary): NavTask {
    const id = task.id.replace(
      /^T-?0*(\d+)$/,
      (_, number: string) => `T${number.padStart(3, '0')}`,
    );
    return {
      id: task.id,
      title: `${id} · ${task.title}`,
      tip: `${id} · ${task.title}`,
      sub: `${statusLabel(task.status)} · ${task.milestone ? `${task.milestone.id} · ${task.milestone.title}` : t('board.loose')}`,
      kind: activeKind(task) ?? 'working',
    };
  }
  async function readActive(start: number) {
    const source = data.catalog?.active;
    return source
      ? (await data.page(source, start)).flatMap((entry) =>
          entry.kind === 'task' ? [entry.task] : [],
        )
      : [];
  }
</script>

<NavPanel
  title={project.name}
  logo={project.logo}
  {items}
  active={section}
  bind:collapsed
  bind:width={navigation.width}
  onresize={() => navigation.save()}
  taskCount={data.catalog?.active.count ?? 0}
  {taskContent}
  {ontask}
  {onselect}
  {footerContent}
/>

{#snippet footerContent(rail: boolean)}
  <ProjectLimitNav {rail} snapshot={limits.snapshot} warning={limitPercent} onclick={onlimits} />
{/snippet}

{#snippet taskContent(row: Snippet<[NavTask, Snippet?]>, rail: boolean)}
  <WindowedContent
    count={data.catalog?.active.count ?? 0}
    revision={data.version}
    read={readActive}
    scroller={rail ? '.nav-active-rail' : '.nav-active-list'}
    gap={2}
    estimate={rail ? 24 : 30}
  >
    {#snippet children(task)}
      {#snippet indicator()}<ActivityMark
          kind={task.activity ?? 'waiting_model'}
          size={12}
        />{/snippet}
      {@render row(
        navTask(task),
        task.status === 'in_progress' || task.merge === 'running' ? indicator : undefined,
      )}
    {/snippet}
  </WindowedContent>
{/snippet}
