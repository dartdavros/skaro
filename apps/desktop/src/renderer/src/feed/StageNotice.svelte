<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import { t } from '@skaro/ui';
  import { useFeed } from './context.svelte';

  /**
   * Result lines of a task that works in a stage ("Задача в этапе" mockup): done and waiting for
   * the merge of the stage, then merged with it. The merge is undone on the stage, not here.
   */
  let { row }: { row: Extract<FeedRow, { type: 'notice' }> } = $props();
  const feed = useFeed();
  const stage = $derived(row.item.stage ?? row.item.text);
</script>

<div class="fd-divider">
  {#if row.item.code === 'stage_done'}
    <span
      >{t('feed.notice.stageDone', { stage })}{#if feed.openStage}
        ·
        <button type="button" class="link" onclick={() => feed.openStage?.(stage)}
          >{t('feed.notice.openStage')}</button
        >{/if}</span
    >
  {:else}
    <span>{t('feed.notice.stageMerged', { branch: row.item.text, stage })}</span>
  {/if}
</div>

<style>
  .link {
    padding: 0;
    border: none;
    background: none;
    color: var(--sk-link);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .link:hover {
    color: var(--sk-link-hover);
  }
</style>
