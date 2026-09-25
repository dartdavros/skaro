<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import { t } from '@skaro/ui';
  import Chevron from './Chevron.svelte';
  import { clock } from './context.svelte';
  import { clock as formatClock, duration } from './format';

  /** "Думал 12 с": folded by default, opens to the dimmed text (agent-output.md 7.1). */
  let { row }: { row: Extract<FeedRow, { type: 'reasoning' }> } = $props();

  let open = $state(false);
  const running = $derived(row.item.status === 'running');
  const ms = $derived(
    (row.item.endedAt ?? (running ? clock.now : row.item.startedAt)) - row.item.startedAt,
  );
  const text = $derived(row.item.text?.trim() ?? '');
</script>

<div class="fd-block gap6">
  {#if running}
    <div class="fd-live">
      <span class="fd-pulse"></span>{t('feed.live.thinking')}
      {formatClock(ms)}
    </div>
  {:else if row.item.redacted || !text}
    <div class="fd-fold static" data-tip={t('feed.thought.hiddenTip')} style="padding-left: 19px">
      {t('feed.thought.hidden', { d: duration(ms) })}
    </div>
  {:else}
    <button
      type="button"
      class="fd-fold"
      data-tip={t('feed.thought.tip')}
      onclick={() => (open = !open)}
    >
      <Chevron {open} />{t('feed.thought', { d: duration(ms) })}
    </button>
    {#if open}<div class="fd-reasoning">{text}</div>{/if}
  {/if}
</div>
