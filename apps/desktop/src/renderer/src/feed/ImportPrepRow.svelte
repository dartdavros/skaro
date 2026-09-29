<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import { t, tn } from '@skaro/ui';
  import Chevron from './Chevron.svelte';

  /**
   * "Подготовлено 30 файлов · 12 пропущено" (AgentChat mockup, import chat): the copy of the
   * sources Skaro made; opens to every file and what was done with it.
   */
  let { row }: { row: Extract<FeedRow, { type: 'import_prep' }> } = $props();

  let open = $state(false);
</script>

<div class="fd-block gap4">
  <button
    type="button"
    class="fd-fold"
    data-tip={t('feed.importPrep.tip')}
    onclick={() => (open = !open)}
  >
    <Chevron {open} />
    <span
      >{tn('feed.importPrep', row.item.prepared)}{#if row.item.skipped}&nbsp;· {t(
          'feed.importPrep.skipped',
          { n: row.item.skipped },
        )}{/if}</span
    >
  </button>
  {#if open}
    <div class="fd-sublist">
      {#each row.item.files as file, i (i)}
        <div class="fd-subrow">
          <span class="main" class:skipped={file.skipped}>{file.path}</span>
          <span class="meta">{file.note}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .main.skipped {
    color: var(--sk-text-23);
  }
</style>
