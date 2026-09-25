<script lang="ts">
  import { t } from '@skaro/ui';
  import type { TaskStatus } from '../../../shared/ipc';

  /** Task status chip of the task screen (mockup "Задача"). */
  let { status }: { status: TaskStatus } = $props();
</script>

<span class="chip">
  {#if status === 'in_progress'}
    <span class="dot working"></span>
  {:else if status === 'needs_answer' || status === 'review'}
    <span class="dot blue"></span>
  {:else if status === 'failed'}
    <span class="dot red"></span>
  {:else if status === 'done'}
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.6"
      stroke-linecap="round"
      stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg
    >
  {:else if status === 'blocked'}
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      ><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"
      ></path></svg
    >
  {:else}
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"><circle cx="12" cy="12" r="8" stroke-dasharray="3 3"></circle></svg
    >
  {/if}
  {t(`task.status.${status}`)}
</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 22px;
    padding: 0 9px;
    align-self: flex-start;
    border-radius: 6px;
    background: #222;
    color: #a6a6a6;
    font-size: 12px;
    font-weight: 600;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .dot.working {
    background: #a6a6a6;
    animation: skPulse 1.6s ease-in-out infinite;
  }

  .dot.blue {
    background: #2a52be;
  }

  .dot.red {
    background: #ef6a63;
  }
</style>
