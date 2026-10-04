<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { TaskStatus } from '../../../shared/ipc';
  import { boardStatus, STATUS_META, statusLabel } from './model';

  /**
   * Status with its icon, in the colour of the status (list view of the Tasks mockup). A task
   * of a stage says more: done and waiting for the merge of the stage, or waiting its turn.
   */
  let {
    status,
    stageDone = false,
    after,
  }: { status: TaskStatus; stageDone?: boolean; after?: string | undefined } = $props();

  const kind = $derived(boardStatus(status));
</script>

{#if stageDone}
  <span class="status stage">
    <Icon name="check" size={12} stroke={2.4} />{t('board.stage.done')}
  </span>
{:else if after}
  <span class="status stage">
    <Icon name="clock" size={12} stroke={2.1} />{t('board.stage.queue')}
    <span class="mono">{after}</span>
  </span>
{:else}
  <span class="status" style="color: {STATUS_META[kind].color}">
    {#if kind === 'working'}
      <span class="dot" class:pulse={status !== 'queued'}></span>
    {:else if kind === 'need'}
      <Icon name="message" size={12} stroke={2.1} />
    {:else if kind === 'review'}
      <Icon name="eye" size={12} stroke={2.1} />
    {:else if kind === 'blocked'}
      <Icon name="lock" size={11} stroke={2.1} />
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
    {statusLabel(status)}
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
