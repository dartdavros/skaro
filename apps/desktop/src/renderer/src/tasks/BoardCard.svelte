<script lang="ts">
  import './board-card.css';
  import { AgentLogo, Checkbox, Icon, t } from '@skaro/ui';
  import type { TaskSummary } from '../../../shared/ipc';
  import { agoLong } from '../ago';
  import { agentLine, boardStatus, statusLabel, waitsStageMerge } from './model';

  /**
   * A task card of the board (Tasks mockup): title, lock or status dot; milestone; time and
   * agent logo. The column already says the status, the card does not repeat it. While
   * `selecting` ("Выбрать несколько") it shows a checkbox and a click anywhere selects it
   * instead of opening the task.
   * It is dragged by the pointer (`ondragstart`) or taken with Space (`onkey`); `ghost` is the
   * copy that follows the pointer, `dropped` plays the landing.
   */
  let {
    task,
    selected,
    selecting,
    now,
    ghost = false,
    dropped = false,
    onselect,
    onopen,
    ondragstart,
    onkey,
  }: {
    task: TaskSummary;
    selected: boolean;
    selecting: boolean;
    now: number;
    ghost?: boolean;
    dropped?: boolean;
    onselect?: (on: boolean) => void;
    onopen?: () => void;
    ondragstart?: (e: PointerEvent) => void;
    onkey?: (e: KeyboardEvent) => void;
  } = $props();

  const short = (id: string) => id.replace(/^T-0*(\d+)$/, 'T$1');
  const shortId = $derived(short(task.id));
  // Done in the branch of its stage: dimmed, it needs nothing until the stage is merged.
  const stageDone = $derived(waitsStageMerge(task));
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
  const pickTip = $derived(selected ? t('board.unselect') : t('board.select'));

  function activate(): void {
    if (selecting) onselect?.(!selected);
    else onopen?.();
  }
</script>

<div
  class="card board-card"
  class:selected
  class:selecting
  class:ghost
  class:dropped
  class:dim={kind === 'blocked' && !ghost}
  class:stage-done={stageDone && !ghost}
  role="button"
  tabindex={ghost ? -1 : 0}
  aria-hidden={ghost || undefined}
  data-card={ghost ? undefined : task.id}
  data-tip={ghost ? undefined : selecting ? pickTip : t('board.open')}
  aria-roledescription={ghost ? undefined : t('board.dnd.card')}
  onclick={activate}
  onpointerdown={(e) => ondragstart?.(e)}
  onkeydown={(e) => {
    // Keys pressed on the checkbox are its own.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') activate();
    else onkey?.(e);
  }}
>
  <div class="top">
    {#if selecting}
      <!-- The checkbox selects; it never starts a drag. -->
      <span class="check" role="presentation" onpointerdown={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} tip={pickTip} onchange={(on) => onselect?.(on)} />
      </span>
    {/if}
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
      >{stageDone && task.milestone
        ? `${task.milestone.id} · ${t('board.stage.review')}`
        : task.milestone
          ? `${task.milestone.id} · ${task.milestone.title}`
          : t('board.loose')}</span
    >
    {#if task.after}
      <span class="after"
        >{t('board.stage.after')} <span class="mono">{short(task.after)}</span></span
      >
    {/if}
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
