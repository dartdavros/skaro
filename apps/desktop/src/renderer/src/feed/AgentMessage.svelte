<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import Markdown from './Markdown.svelte';
  import ReplyActions from './ReplyActions.svelte';

  /**
   * Agent text. Interim replies are quieter; "Copy" and "Retry" only under the final answer of a
   * turn (agent-output.md 5.1), below the turn summary when there is one (mockup 5a).
   */
  let {
    row,
    retryOf,
    actions = true,
  }: {
    row: Extract<FeedRow, { type: 'agent' }>;
    retryOf?: { id: string; text: string } | undefined;
    /** False when the turn summary right below carries the actions. */
    actions?: boolean;
  } = $props();
</script>

<div class="fd-text" class:commentary={row.item.phase === 'commentary'}>
  <Markdown text={row.item.text} />
</div>
{#if actions && row.final && row.item.status !== 'running'}
  <ReplyActions text={row.item.text} {retryOf} />
{/if}
