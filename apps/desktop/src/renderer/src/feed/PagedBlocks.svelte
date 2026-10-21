<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HistoryBlock, HistorySource } from '../../../shared/history';
  import { useFeed } from './context.svelte';
  import { HistoryViewport } from './history-viewport.svelte';
  import { useFeedLoading } from './feed-loading.svelte';
  let {
    source,
    children,
    primary = false,
    gap = 14,
    initial,
  }: {
    source: HistorySource;
    children: Snippet<[HistoryBlock]>;
    primary?: boolean;
    gap?: number;
    initial?: import('../../../shared/history').HistoryPage;
  } = $props();
  // svelte-ignore state_referenced_locally
  const viewport = new HistoryViewport(
    () => source,
    () => primary,
    useFeed(),
    gap,
    () => initial,
  );
  const measure = (element: HTMLElement, index: number) => viewport.measure(element, index);
  const loading = useFeedLoading();
  const token = Symbol('history');
  $effect(() => {
    loading?.track(token, viewport.loading);
    return () => loading?.track(token, false);
  });
</script>

<div class="virtual-blocks" bind:this={viewport.root} style:--history-gap={`${gap}px`}>
  {#each viewport.shown as { index, block, before } (block?.id ?? `loading-${index}`)}
    {#if before > 0}<div aria-hidden="true" style:height={`${before}px`}></div>{/if}
    <div
      class="virtual-block"
      data-feed-block={block?.id}
      data-history-index={index}
      use:measure={index}
    >
      {#if block}{@render children(block)}
      {:else}<div aria-hidden="true" style:height={`${viewport.window.estimate}px`}></div>{/if}
    </div>
  {/each}
  {#if viewport.bottom > 0}<div aria-hidden="true" style:height={`${viewport.bottom}px`}></div>{/if}
</div>

<style>
  .virtual-blocks,
  .virtual-block {
    display: flex;
    flex-direction: column;
    gap: var(--history-gap, 14px);
    min-width: 0;
  }
  .virtual-blocks > div {
    flex: none;
  }
</style>
