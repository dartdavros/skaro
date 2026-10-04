<script lang="ts">
  import { t } from '@skaro/ui';
  import { clock } from './context.svelte';
  import { clock as formatClock } from './format';
  import type { PinnedZoneController } from './pinned-zone-controller.svelte';
  let { state }: { state: PinnedZoneController } = $props();
</script>

{#if state.opened?.output}
  <div data-pinned-zone class="fd-output" style="max-height: 180px; border-radius: 10px">
    {state.opened.output.replace(/\s+$/, '')}
  </div>
{/if}
{#each state.background as command (command.id)}
  {@const running = command.background?.state === 'running'}
  <div
    data-pinned-zone
    class="fd-pinned"
    role="button"
    tabindex="0"
    style="cursor: pointer"
    data-tip={t('pinned.bg.show')}
    onclick={() => (state.outputOf = state.outputOf === command.id ? undefined : command.id)}
    onkeydown={(e) =>
      e.key === 'Enter' &&
      (state.outputOf = state.outputOf === command.id ? undefined : command.id)}
  >
    {#if running}<span data-pinned-zone class="fd-pulse"></span>{:else}<span
        data-pinned-zone
        class="fd-dot-gray"
      ></span>{/if}
    <span data-pinned-zone class="cmd">$ {command.command}</span>
    <span data-pinned-zone class="when">
      {#if running}
        {t('pinned.bg.running', { t: formatClock(clock.now - command.startedAt) })}
      {:else if command.background?.state === 'stopped'}
        {t('pinned.bg.stopped')}
      {:else}
        {t('pinned.bg.done')} · {formatClock((command.endedAt ?? clock.now) - command.startedAt)}
      {/if}
    </span>
    {#if running && state.feed.interactive}
      <button
        data-pinned-zone
        type="button"
        class="stop"
        data-tip={t('pinned.bg.stop')}
        aria-label={t('pinned.bg.stop')}
        onclick={(e) => {
          e.stopPropagation();
          state.feed.stopBackground(command.background!.taskId);
        }}
      >
        <svg data-pinned-zone width="13" height="13" viewBox="0 0 24 24" fill="currentColor"
          ><rect data-pinned-zone x="6" y="6" width="12" height="12" rx="2"></rect></svg
        >
      </button>
    {/if}
  </div>
{/each}
