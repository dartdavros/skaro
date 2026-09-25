<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import { t, tn } from '@skaro/ui';
  import Chevron from './Chevron.svelte';
  import { clock } from './context.svelte';
  import FeedRows from './FeedRows.svelte';
  import { clock as formatClock } from './format';

  /** "↳ Субагент: описание · 14 действий · 0:40", opening into its own feed (mockup 1a). */
  let { row, waiting }: { row: Extract<FeedRow, { type: 'task' }>; waiting: ReadonlySet<string> } =
    $props();

  let open = $state(false);
  const running = $derived(row.item.status === 'running');
  const elapsed = $derived(
    (row.item.endedAt ?? (running ? clock.now : row.item.startedAt)) - row.item.startedAt,
  );
  const summary = $derived(row.item.summary?.trim());
</script>

<div class="fd-block gap6">
  <button
    type="button"
    class="fd-task-row"
    data-tip={running ? t('feed.task.working') : t('feed.task.tip')}
    onclick={() => (open = !open)}
  >
    <span class="arrow">↳</span>
    <span class="title">{row.item.title}</span>
    {#if running}
      <span class="meta"><span class="fd-pulse"></span>{formatClock(elapsed)}</span>
    {:else}
      <span class="meta">{tn('feed.actions', row.actions)} · {formatClock(elapsed)}</span>
    {/if}
    <Chevron {open} color="#6f6f6f" />
  </button>
  {#if open}
    <div class="fd-nested">
      <FeedRows rows={row.children} {waiting} nested />
      {#if summary && !row.children.some((c) => c.type === 'agent')}
        <div class="fd-text">{summary}</div>
      {/if}
    </div>
  {/if}
</div>
