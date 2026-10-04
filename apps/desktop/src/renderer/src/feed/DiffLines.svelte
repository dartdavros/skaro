<script lang="ts">
  import type { DiffLine } from './diff-model';
  import { diffDimensions } from './diff-dimensions';
  let { lines }: { lines: DiffLine[] } = $props();
  let node = $state<HTMLDivElement>();
  let dimensions = $state<ReturnType<typeof diffDimensions>>();
  const large = $derived(lines.length > 200);
  const chunks = $derived(
    large
      ? Array.from({ length: Math.ceil(lines.length / 35) }, (_, index) =>
          lines.slice(index * 35, (index + 1) * 35),
        )
      : [],
  );
  $effect(() => {
    const current = node;
    const entries = lines;
    dimensions = undefined;
    if (!current || !large) return;
    let disposed = false;
    const measure = () => {
      if (!disposed) dimensions = diffDimensions(current, entries);
    };
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener('loadingdone', measure);
    return () => {
      disposed = true;
      document.fonts.removeEventListener('loadingdone', measure);
    };
  });
</script>

{#snippet line(entry: DiffLine)}
  {#if entry.kind === 'sep'}
    <div class="fd-diff-sep"></div>
  {:else}
    <div class="fd-diff-line {entry.kind}">
      <span class="sign">{entry.sign}</span><span>{entry.text}</span>
    </div>
  {/if}
{/snippet}

<div class="fd-diff" bind:this={node}>
  {#if large}
    {#each chunks as chunk, index (index)}
      <div
        class="fd-diff-chunk"
        class:contained={dimensions !== undefined}
        style:min-width={dimensions ? `${dimensions.width}px` : undefined}
        style:contain-intrinsic-block-size={dimensions
          ? `auto ${chunk.reduce((height, entry) => height + (entry.kind === 'sep' ? dimensions!.separatorHeight : dimensions!.lineHeight), 0)}px`
          : undefined}
      >
        {#each chunk as entry, at (at)}{@render line(entry)}{/each}
      </div>
    {/each}
  {:else}
    {#each lines as entry, at (at)}{@render line(entry)}{/each}
  {/if}
</div>

<style>
  .contained {
    content-visibility: auto;
  }
</style>
