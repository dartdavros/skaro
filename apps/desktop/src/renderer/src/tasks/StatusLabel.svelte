<script lang="ts">
  import { Icon } from '@skaro/ui';
  import type { TaskStatus } from '../../../shared/ipc';
  import { boardStatus, STATUS_META, statusLabel } from './model';

  /** Status with its icon, in the colour of the status (list view of the Tasks mockup). */
  let { status }: { status: TaskStatus } = $props();

  const kind = $derived(boardStatus(status));
</script>

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

<style>
  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--sk-fs-4);
    font-weight: 600;
    white-space: nowrap;
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
