<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import { t } from '@skaro/ui';
  import { useFeed } from './context.svelte';
  import { imageUrl } from './format';

  /** An image the agent viewed or generated (mockup 9a). */
  let { row }: { row: Extract<FeedRow, { type: 'image' }> } = $props();

  const feed = useFeed();
  const src = $derived(imageUrl(row.item.image));
  let failed = $state(false);
</script>

<div class="fd-block gap6">
  {#if failed}
    <div class="error"><span>{t('feed.image.error')}</span></div>
  {:else}
    <button
      type="button"
      class="fd-image-frame"
      data-tip={t('feed.image.open')}
      onclick={() => feed.viewImage(src)}
    >
      <img {src} alt={row.item.caption ?? ''} onerror={() => (failed = true)} />
    </button>
  {/if}
  {#if row.item.caption}<span class="fd-caption">{row.item.caption}</span>{/if}
</div>

<style>
  .error {
    width: 360px;
    height: 120px;
    border-radius: 10px;
    background: #1a1a1a;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #7d7d7d;
    font-size: 12px;
  }
</style>
