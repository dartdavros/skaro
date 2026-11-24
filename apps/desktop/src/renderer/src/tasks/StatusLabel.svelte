<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { MergeProgress, TaskStatus } from '../../../shared/ipc';
  import { boardStatus, mergeKey, STATUS_META, statusLabel, type BoardStatus } from './model';
  import type { ResourceWait } from '../../../shared/resource-wait';
  import { resourceWaitLabel, resourceWaitDetail } from '../resource-wait';

  /**
   * Status with its icon, in the colour of the status (list view of the Tasks mockup). A task
   * waiting its turn in a shared checkout says after which one; an accepted task whose merge is
   * at work or failed says that with the mark of that state.
   */
  let {
    status,
    after,
    merge,
    mergeAfter,
    resourceWait,
  }: {
    status: TaskStatus;
    resourceWait?: ResourceWait;
    after?: string | undefined;
    merge?: MergeProgress | undefined;
    /** In line for the merge behind this task. */
    mergeAfter?: string | undefined;
  } = $props();

  // A conflict is the work of the task itself: its own status says whether the agent is at it.
  const MERGE: Record<Exclude<MergeProgress, 'conflict'>, BoardStatus> = {
    running: 'working',
    queued: 'working',
    needs_answer: 'need',
    failed: 'error',
  };
  const own = $derived(!merge || merge === 'conflict');
  const kind = $derived(merge && merge !== 'conflict' ? MERGE[merge] : boardStatus(status));
  const label = $derived(
    resourceWait
      ? resourceWaitLabel(resourceWait)
      : merge
        ? t(`board.merge.${mergeKey(merge, status)}`)
        : statusLabel(status),
  );
  const pulse = $derived(!resourceWait && (own ? status !== 'queued' : merge === 'running'));
</script>

{#if after && !resourceWait}
  <span class="status stage">
    <Icon name="clock" size={12} stroke={2.1} />{t('board.stage.queue')}
    <span class="mono">{after}</span>
  </span>
{:else}
  <span
    class="status"
    data-tip={resourceWait && resourceWaitDetail(resourceWait)}
    style="color: {STATUS_META[kind].color}"
  >
    {#if kind === 'working'}
      <span class="dot" class:pulse></span>
    {:else if kind === 'need'}
      <Icon name="message" size={12} stroke={2.1} />
    {:else if kind === 'review'}
      <Icon name="eye" size={12} stroke={2.1} />
    {:else if kind === 'blocked'}
      <Icon name="lock" size={11} stroke={2.1} />
    {:else if kind === 'paused' || kind === 'stopped'}
      <Icon name={kind === 'paused' ? 'pause' : 'stopSquare'} size={12} stroke={2.1} />
    {:else if kind === 'error'}
      <Icon name="errorCircle" size={12} stroke={2.1} />
    {:else if kind === 'done'}
      <Icon name="check" size={12} stroke={2.4} />
    {:else}
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"><circle cx="12" cy="12" r="8" stroke-dasharray="3 3" /></svg
      >
    {/if}
    {label}{#if mergeAfter}<span class="after"
        >· {t('board.stage.after')} <span class="mono">{mergeAfter}</span></span
      >{/if}
  </span>
{/if}

<style>
  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--sk-fs-4);
    font-weight: 600;
    white-space: nowrap;
  }

  .status.stage {
    color: var(--sk-text-secondary);
  }

  .mono {
    font-family: var(--sk-mono);
    font-weight: 400;
  }

  .after {
    font-weight: 400;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--sk-fill-41);
  }

  .dot.pulse {
    animation: skPulse 1.6s ease-in-out infinite;
  }
</style>
