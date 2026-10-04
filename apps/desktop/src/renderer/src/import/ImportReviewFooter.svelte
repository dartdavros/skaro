<script lang="ts">
  import { t } from '@skaro/ui';
  import type { ImportReviewState } from './import-review-state.svelte';
  let { state }: { state: ImportReviewState } = $props();
</script>

<div class="foot">
  <span class="picked"
    >{t('import.review.picked.before')}<span class="mono">{state.picked.length}</span>{t(
      'import.review.picked.middle',
    )}<span class="mono">{state.items.length}</span></span
  >
  <button type="button" class="cancel" disabled={state.applying} onclick={() => state.onclose()}
    >{t('ui.cancel')}</button
  >
  {#if state.applying}
    <button type="button" class="applying" data-tip={t('import.review.applying.tip')}>
      <span
        class="bar"
        style="width: {state.progress.total
          ? Math.round((state.progress.done / state.progress.total) * 100)
          : 0}%"
      ></span>
      <span class="bar-text"
        >{t('import.review.applying', { n: state.progress.done, of: state.progress.total })}</span
      >
    </button>
  {:else}
    <button
      type="button"
      class="apply"
      class:ok={state.picked.length > 0}
      disabled={!state.picked.length}
      data-tip={state.picked.length ? undefined : t('import.review.nothing')}
      onclick={() => void state.apply()}>{t('import.review.apply')}</button
    >
  {/if}
</div>
