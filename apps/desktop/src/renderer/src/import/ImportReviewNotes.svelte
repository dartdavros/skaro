<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { ImportReviewState } from './import-review-state.svelte';
  let { state }: { state: ImportReviewState } = $props();
</script>

<div class="sep"></div>
{#if state.review?.skipped.length}
  <button type="button" class="fold" onclick={() => (state.skippedOpen = !state.skippedOpen)}>
    <span class="chev" class:open={state.skippedOpen}
      ><Icon name="chevronRight" size={12} stroke={2.4} /></span
    >
    {t('import.review.skipped')}&nbsp;·&nbsp;<span class="mono">{state.review.skipped.length}</span>
  </button>
  {#if state.skippedOpen}
    <div class="skipped">
      {#each state.review.skipped as s, i (i)}
        <div class="skipped-row">
          <span class="skipped-path">{s.path}</span>
          <span class="skipped-why">{s.reason}</span>
        </div>
      {/each}
    </div>
  {/if}
{/if}
{#if state.review?.notes.length}
  <button type="button" class="fold" onclick={() => (state.notesOpen = !state.notesOpen)}>
    <span class="chev" class:open={state.notesOpen}
      ><Icon name="chevronRight" size={12} stroke={2.4} /></span
    >
    {t('import.review.notes')}&nbsp;·&nbsp;<span class="mono">{state.review.notes.length}</span>
  </button>
  {#if state.notesOpen}
    <div class="notes">
      {#each state.review.notes as note, i (i)}<span>{note}</span>{/each}
    </div>
  {/if}
{/if}
