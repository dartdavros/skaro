<script lang="ts">
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
  <span class="grip" data-tip={t('plan.dragTask')}><Icon name="grip" size={13} stroke={2} /></span>
  <span class="st" data-tip={tip}>
    {#if st === 'working' || st === 'need' || st === 'review' || st === 'error'}
      <span class="dot {st}" class:pulse={task.status === 'in_progress'}></span>
    {:else if st === 'blocked'}
      <Icon name="lock" size={13} stroke={2} color="var(--sk-text-20)" />
    {:else if st === 'done'}
      <Icon name="check" size={13} stroke={2.6} color="var(--sk-text-25)" />
    {:else if st === 'cancel'}
      <Icon name="close" size={12} stroke={2.4} color="var(--sk-text-27)" />
    {:else}
      <span class="ring"></span>
    {/if}
  </span>
  <span class="id">{task.id}</span>
  <span class="title" class:muted={doneLike(st)} class:strike={st === 'cancel'}>{task.title}</span>
  <span class="rels">
    {#if relation === 'up' || relation === 'down'}
      <span class="rel">{relation === 'up' ? t('plan.rel.up') : t('plan.rel.down')}</span>
    {/if}
    {#each task.deps as dep (dep)}
      {@const d = byId.get(dep)}
      <span
        class="dep"
        class:met={d?.status === 'done'}
        data-tip={t('plan.dep.tip', { id: dep, title: d?.title ?? '' })}>← {dep}</span
      >
    {/each}
  </span>
  <span class="agent" data-tip={task.agent ? agentLine(task) : t('plan.noAgent')}>
    {#if task.agent}<AgentLogo agent={task.agent} size={16} />{/if}
  </span>
  <span class="time">{time}</span>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: 14px 16px 52px minmax(0, 1fr) auto 20px 64px;
    align-items: center;
    gap: 10px;
    height: 38px;
    padding: 0 10px 0 0;
    border-radius: 8px;
    cursor: pointer;
    outline: none;
    transition:
      background 0.12s,
      opacity 0.12s;
  }

  .row.self {
    background: var(--sk-fill-18);
  }

  .row.related {
    background: var(--sk-accent-a14);
  }

  .row.faded {
    opacity: 0.45;
  }

  .row.dragged {
    opacity: 0.4;
  }

  .row.drop {
    box-shadow: inset 0 2px 0 var(--sk-accent);
  }

  .grip {
    display: inline-flex;
    justify-content: center;
    color: var(--sk-text-29);
    cursor: grab;
  }

  .st {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--sk-accent);
  }

  .dot.working {
    background: var(--sk-fill-41);
  }

  .dot.error {
    background: var(--sk-error);
  }

  .dot.pulse {
    animation: skPulse 1.6s ease-in-out infinite;
  }

  .ring {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px var(--sk-fill-36);
  }

  .id {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-19);
  }

  .title {
    min-width: 0;
    font-size: var(--sk-fs-6);
    color: var(--sk-text-6);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title.muted {
    color: var(--sk-text-21);
  }

  .title.strike {
    text-decoration: line-through;
  }

  .rels {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .rel {
    font-size: var(--sk-fs-3);
    color: var(--sk-link);
  }

  .dep {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-13);
  }

  .dep.met {
    color: var(--sk-text-26);
  }

  .agent {
    display: inline-flex;
    justify-content: center;
    color: var(--sk-text-7);
  }

  .time {
    text-align: right;
    font-size: var(--sk-fs-3);
    color: var(--sk-text-23);
  }
</style>
