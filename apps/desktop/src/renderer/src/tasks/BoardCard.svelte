<script lang="ts">
  import './board-card.css';
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

  const shortId = $derived(task.id.replace(/^T-0*(\d+)$/, 'T$1'));
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
  class="card board-card"
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
    <span class="title" class:muted>{shortId} · {task.title}</span>
    {#if kind === 'blocked'}
      <span class="lock" data-tip={t('board.lock', { deps: task.waitsFor.join(', ') })}
        ><Icon name="lock" size={13} stroke={2} /></span
      >
    {/if}
    {#if dot}<span class="dot {dot}" data-tip={statusLabel(task.status)}></span>{/if}
  </div>
  <div class="meta">
    <span class="ms"
      >{task.milestone ? `${task.milestone.id} · ${task.milestone.title}` : t('board.loose')}</span
    >
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
