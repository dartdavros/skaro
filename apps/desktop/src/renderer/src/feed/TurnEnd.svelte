<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import { Icon, t, tn } from '@skaro/ui';
  import { useFeed } from './context.svelte';
  import { clock, tokens } from './format';
  import ReplyActions from './ReplyActions.svelte';

  /** End of a turn: time and tokens only here; an error in red with "Перезапустить" (mockup 5a). */
  let {
    row,
    last,
    reply,
  }: {
    row: Extract<FeedRow, { type: 'turn_end' }>;
    last: boolean;
    /** The final answer right above: its actions go under the summary. */
    reply?: { text: string; retryOf?: { id: string; text: string } | undefined } | undefined;
  } = $props();

  const feed = useFeed();
  const outcome = $derived(row.turn.outcome);
  const category = $derived(row.turn.error?.category ?? 'other');

  const text = $derived.by(() => {
    if (outcome === 'failed') {
      return t('feed.end.failed', { reason: t(`feed.error.${category}`) });
    }
    if (outcome === 'interrupted') return `${t('feed.end.interrupted')} · ${clock(row.durationMs)}`;
    const parts = [t('feed.end.done')];
    if (row.files) parts.push(tn('feed.files', row.files));
    parts.push(clock(row.durationMs));
    if (row.tokens) parts.push(tokens(row.tokens));
    return parts.join(' · ');
  });
</script>

<div class="fd-bar" class:error={outcome === 'failed'} data-tip={row.turn.error?.message}>
  {#if outcome === 'failed'}
    <Icon name="error" size={13} stroke={2.2} color="#ef6a63" />
  {:else if outcome === 'interrupted'}
    <Icon name="stopSquare" size={13} stroke={2.2} color="#8a8a8a" />
  {:else}
    <Icon name="check" size={13} stroke={2.4} color="#8a8a8a" />
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
  <ReplyActions text={reply.text} retryOf={reply.retryOf} />
{/if}
