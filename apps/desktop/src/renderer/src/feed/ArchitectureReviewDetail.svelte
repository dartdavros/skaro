<script lang="ts">
  import { Banner, t } from '@skaro/ui';
  import type { C4ReviewDetail } from '../../../shared/c4-review';
  import { useFeed } from './context.svelte';
  import LoadingIndicator from '../LoadingIndicator.svelte';
  import DiffLines from './DiffLines.svelte';
  import Markdown from './Markdown.svelte';
  import { sourceDiff } from './architecture-review';
  let {
    itemId,
    selected,
    mode,
  }: { itemId: string; selected: string; mode: 'changes' | 'before' | 'after' } = $props();
  const feed = useFeed();
  let detail = $state.raw<C4ReviewDetail>();
  let error = $state('');
  $effect(() => {
    let current = true;
    detail = undefined;
    error = '';
    void feed.architectureReviewDetail?.(itemId, selected).then(
      (value) => {
        if (current) detail = value;
      },
      (reason) => {
        if (current) error = String(reason);
      },
    );
    return () => {
      current = false;
    };
  });
  const source = $derived(detail && mode !== 'changes' ? detail[mode] : '');
  const document = $derived(selected.startsWith('document:'));
</script>

<div class="detail">
  {#if error}<Banner kind="error" text={error} />
  {:else if !detail}<div class="loading"><LoadingIndicator /></div>
  {:else if mode === 'changes'}
    {#if detail.comparison.status === 'unavailable'}<Banner
        kind="info"
        text={t('c4.review.unavailable')}
      />
    {:else}<DiffLines row={{ diffs: [detail.comparison.patch], change: 'update' }} />{/if}
  {:else if document}<div class="document"><Markdown text={source} /></div>
  {:else}<DiffLines row={{ diffs: [sourceDiff(source)], change: 'update' }} />{/if}
</div>

<style>
  .detail {
    flex: 1;
    min-height: 240px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .detail :global(.fd-diff) {
    flex: 1;
    min-height: 0;
    max-height: none;
  }
  .loading {
    display: grid;
    place-items: center;
    min-height: 240px;
  }
  .document {
    overflow: auto;
    padding: 18px;
  }
</style>
