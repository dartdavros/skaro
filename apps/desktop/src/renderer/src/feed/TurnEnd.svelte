<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import { Icon, t } from '@skaro/ui';
  import { useFeed } from './context.svelte';
  import { clock } from './format';
  import ReplyActions from './ReplyActions.svelte';
  import TurnFiles from './TurnFiles.svelte';

  /**
   * End of a turn: the changed files, then "Скопировать" with the time; an error in red
   * with "Перезапустить" (mockup 5a).
   */
  let {
    row,
    last,
    reply,
  }: {
    row: Extract<FeedRow, { type: 'turn_end' }>;
    last: boolean;
    /** Text of the turn's final answer: its "Скопировать" goes under the summary. */
    reply?: string | undefined;
  } = $props();

  const feed = useFeed();
  const outcome = $derived(row.turn.outcome);
  const category = $derived(row.turn.error?.category ?? 'other');

  const text = $derived.by(() => {
    if (outcome === 'failed') {
      return t('feed.end.failed', { reason: t(`feed.error.${category}`) });
    }
    return `${t('feed.end.interrupted')} · ${clock(row.durationMs)}`;
  });
</script>

{#if outcome === 'done'}
  {#if row.files.length}<TurnFiles files={row.files} />{/if}
  {#if reply}
    <ReplyActions text={reply}
      ><span class="fd-turn-meta">{clock(row.durationMs)}</span></ReplyActions
    >
  {:else}
    <div class="fd-after-final"><span class="fd-turn-meta">{clock(row.durationMs)}</span></div>
  {/if}
{:else}
  <div class="fd-bar" class:error={outcome === 'failed'} data-tip={row.turn.error?.message}>
    {#if outcome === 'failed'}
      <Icon name="error" size={13} stroke={2.2} color="var(--sk-error)" />
    {:else}
      <Icon name="stopSquare" size={13} stroke={2.2} color="var(--sk-text-20)" />
    {/if}
    <span class="text">{text}</span>
    {#if outcome === 'failed' && last && feed.interactive}
      <button
        type="button"
        class="action"
        data-tip={category === 'auth' ? t('feed.end.restart.authTip') : t('feed.end.restart.tip')}
        onclick={() => feed.restart()}>{t('feed.end.restart')}</button
      >
    {/if}
  </div>
  {#if reply}
    <ReplyActions text={reply} />
  {/if}
{/if}

<style>
  .fd-turn-meta {
    display: inline-flex;
    align-items: center;
    margin-left: 6px;
    font-size: var(--sk-fs-4);
    color: var(--sk-text-19);
  }
</style>
