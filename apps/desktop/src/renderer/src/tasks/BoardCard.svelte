<script lang="ts">
  import { AgentLogo, Checkbox, Icon, t } from '@skaro/ui';
  import type { TaskSummary } from '../../../shared/ipc';
  import { agoLong } from '../ago';
  import { agentLine, boardStatus, statusLabel } from './model';

  /**
   * A task card of the board (Tasks mockup): checkbox, title, lock or status dot; milestone;
   * time and agent logo. The column already says the status, the card does not repeat it.
   */
  let {
    task,
    selected,
    now,
    onselect,
    onopen,
  }: {
    task: TaskSummary;
    selected: boolean;
    now: number;
    onselect: (on: boolean) => void;
    onopen: () => void;
  } = $props();

  const kind = $derived(boardStatus(task.status));
  const muted = $derived(kind === 'blocked' || kind === 'done' || kind === 'cancelled');
  const dot = $derived(
    task.status === 'in_progress'
      ? 'working'
      : kind === 'need'
        ? 'need'
        : kind === 'error'
          ? 'error'
          : undefined,
  );
  const when = $derived(
    task.status === 'in_progress' ? t('agoShort.now') : agoLong(task.updatedAt, now),
  );
</script>

<div
  class="card"
  class:selected
  class:dim={kind === 'blocked'}
  role="button"
  tabindex="0"
  data-tip={t('board.open')}
  onclick={onopen}
  onkeydown={(e) => e.key === 'Enter' && onopen()}
>
  <div class="top">
    <span class="check">
      <Checkbox
        checked={selected}
        tip={selected ? t('board.unselect') : t('board.select')}
        onchange={onselect}
      />
    </span>
    <span class="title" class:muted>{task.title}</span>
    {#if kind === 'blocked'}
      <span class="lock" data-tip={t('board.lock', { deps: task.waitsFor.join(', ') })}
        ><Icon name="lock" size={13} stroke={2} /></span
      >
    {/if}
    {#if dot}<span class="dot {dot}" data-tip={statusLabel(task.status)}></span>{/if}
  </div>
  <div class="meta">
    {#if task.milestone}<span class="ms">{task.milestone.id} · {task.milestone.title}</span>{/if}
  </div>
  <div class="bottom">
    <span
      class="time"
      data-tip={task.status === 'done'
        ? t('board.finished', { when })
        : t('board.updated', { when })}>{when}</span
    >
    {#if task.agent}
      <span class="agent" data-tip={agentLine(task)}
        ><AgentLogo agent={task.agent} size={task.agent === 'codex' ? 16 : 17} /></span
      >
    {/if}
  </div>
</div>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 11px;
    border-radius: 9px;
    background: var(--sk-fill-12);
    cursor: pointer;
    outline: none;
  }

  .card:hover {
    background: var(--sk-fill-18);
  }

  .card.selected {
    background: var(--sk-blue-5);
    box-shadow: inset 0 0 0 1px var(--sk-accent);
  }

  .card.dim {
    opacity: 0.72;
  }

  .top {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .check {
    flex: none;
    margin-top: 1px;
    display: inline-flex;
  }

  .title {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-6);
    font-weight: 600;
    line-height: 1.35;
    color: var(--sk-text-6);
    text-wrap: pretty;
  }

  .title.muted {
    color: var(--sk-text-12);
  }

  .lock {
    flex: none;
    margin-top: 1px;
    display: inline-flex;
    color: var(--sk-text-19);
  }

  .dot {
    flex: none;
    margin-top: 4px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--sk-accent);
  }

  .dot.working {
    background: var(--sk-fill-41);
    animation: skPulse 1.6s ease-in-out infinite;
  }

  .dot.error {
    background: var(--sk-error);
  }

  .meta,
  .bottom {
    padding-left: 22px;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .ms {
    font-size: var(--sk-fs-3);
    color: var(--sk-text-19);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .time {
    font-size: var(--sk-fs-3);
    color: var(--sk-text-21);
  }

  .agent {
    display: inline-flex;
    color: var(--sk-text-19);
  }
</style>
