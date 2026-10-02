<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import { t } from '@skaro/ui';
  import { clock } from './context.svelte';
  import { clock as formatClock } from './format';
  import ThinkingMark from './ThinkingMark.svelte';

  /** "Думает… 0:07" while the agent reasons; a finished "Думал 12 с" is not shown (owner's call). */
  let { row }: { row: Extract<FeedRow, { type: 'reasoning' }> } = $props();

  const ms = $derived(clock.now - row.item.startedAt);
</script>

<div class="fd-block gap6">
  <div class="fd-live">
    <ThinkingMark />{t('feed.live.thinking')}
    {formatClock(ms)}
  </div>
</div>
