<script lang="ts">
  import './task-row.css';
  import { AgentLogo, Icon, t } from '@skaro/ui';
  import type { TaskSummary } from '../../../shared/ipc';
  import { agoOrDate } from '../ago';
  import { agentLine } from '../tasks/model';
  import { doneLike, rowStatus } from './model';

  /** A task row of a milestone (Plan mockup): drag grip, status, id, title, relations, deps, agent, time. */
  let {
    task,
    byId,
    relation,
    faded,
    dragged,
    dropLine,
    now,
    onenter,
    onleave,
    onopen,
    ondragstart,
    ondragover,
    ondrop,
    ondragend,
  }: {
    task: TaskSummary;
    byId: Map<string, TaskSummary>;
    relation?: 'up' | 'down' | 'self';
    faded: boolean;
    dragged: boolean;
    dropLine: boolean;
    now: number;
    onenter: () => void;
    onleave: () => void;
    onopen: () => void;
    ondragstart: (e: DragEvent) => void;
    ondragover: (e: DragEvent) => void;
    ondrop: (e: DragEvent) => void;
    ondragend: () => void;
  } = $props();

  const st = $derived(rowStatus(task.status));
  const tip = $derived(
    st === 'blocked'
      ? t('plan.st.blocked', { deps: task.waitsFor.join(', ') })
      : t(`plan.st.${st}`),
  );
  const time = $derived(st === 'todo' || st === 'blocked' ? '' : agoOrDate(task.updatedAt, now));
</script>

<div
  data-plan-task
  class="row"
  class:self={relation === 'self'}
  class:related={relation === 'up' || relation === 'down'}
  class:faded
  class:dragged
  class:drop={dropLine}
  role="link"
  tabindex="0"
  draggable="true"
  onclick={onopen}
  onkeydown={(e) => e.key === 'Enter' && onopen()}
  onmouseenter={onenter}
  onmouseleave={onleave}
  {ondragstart}
  {ondragover}
  {ondrop}
  {ondragend}
>
  <span data-plan-task class="grip" data-tip={t('plan.dragTask')}
    ><Icon name="grip" size={13} stroke={2} /></span
  >
  <span data-plan-task class="st" data-tip={tip}>
    {#if st === 'working' || st === 'need' || st === 'review' || st === 'error'}
      <span data-plan-task class="dot {st}" class:pulse={task.status === 'in_progress'}></span>
    {:else if st === 'blocked'}
      <Icon name="lock" size={13} stroke={2} color="var(--sk-text-20)" />
    {:else if st === 'done'}
      <Icon name="check" size={13} stroke={2.6} color="var(--sk-text-25)" />
    {:else if st === 'cancel'}
      <Icon name="close" size={12} stroke={2.4} color="var(--sk-text-27)" />
    {:else}
      <span data-plan-task class="ring"></span>
    {/if}
  </span>
  <span data-plan-task class="id">{task.id}</span>
  <span data-plan-task class="title" class:muted={doneLike(st)} class:strike={st === 'cancel'}
    >{task.title}</span
  >
  <span data-plan-task class="rels">
    {#if relation === 'up' || relation === 'down'}
      <span data-plan-task class="rel"
        >{relation === 'up' ? t('plan.rel.up') : t('plan.rel.down')}</span
      >
    {/if}
    {#each task.deps as dep (dep)}
      {@const d = byId.get(dep)}
      <span
        data-plan-task
        class="dep"
        class:met={d?.status === 'done'}
        data-tip={t('plan.dep.tip', { id: dep, title: d?.title ?? '' })}>← {dep}</span
      >
    {/each}
  </span>
  <span data-plan-task class="agent" data-tip={task.agent ? agentLine(task) : t('plan.noAgent')}>
    {#if task.agent}<AgentLogo agent={task.agent} size={16} />{/if}
  </span>
  <span data-plan-task class="time">{time}</span>
</div>
