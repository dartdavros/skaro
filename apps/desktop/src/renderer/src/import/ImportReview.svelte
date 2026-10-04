<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import { onDestroy } from 'svelte';
  import { ImportReviewState, type ReviewOptions } from './import-review-state.svelte';
  import './i18n';
  import ImportReviewList from './ImportReviewList.svelte';
  import ImportReviewPreview from './ImportReviewPreview.svelte';
  import ImportReviewFooter from './ImportReviewFooter.svelte';
  import './import-review-dialog.css';
  import './import-review-list.css';
  import './import-review-preview.css';
  let { projectId, chatId, onclose, onapply }: ReviewOptions = $props();
  const state = new ImportReviewState(() => ({ projectId, chatId, onclose, onapply }));
  onDestroy(() => state.dispose());
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && !state.applying && state.onclose()} />

<div
  class="backdrop import-review"
  role="presentation"
  onclick={() => !state.applying && state.onclose()}
>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-label={t('import.review.title')}
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={() => undefined}
  >
    <div class="head">
      <div class="titles">
        <span class="title">{t('import.review.title')}</span>
        <span class="subtitle">{t('import.review.subtitle')}</span>
      </div>
      <button
        type="button"
        class="x"
        data-tip={t('ui.closeEsc')}
        aria-label={t('ui.close')}
        onclick={() => state.onclose()}><Icon name="close" size={14} stroke={2.2} /></button
      >
    </div>

    {#if state.error}
      <div class="alert" role="alert">
        <Icon name="errorCircle" size={16} stroke={1.9} />
        <span class="alert-text"
          ><strong>{t('import.review.failed')}</strong>
          {#if state.errorIsFile}{t('import.review.changed.before')}<span class="mono"
              >{state.error}</span
            >{t('import.review.changed.after')}{:else}{state.error}{/if}</span
        >
        <button type="button" class="retry" onclick={() => void state.apply()}
          >{t('import.review.retry')}</button
        >
      </div>
    {/if}

    <div class="main">
      <ImportReviewList {state} />

      <ImportReviewPreview {state} />
    </div>

    <ImportReviewFooter {state} />
  </div>
</div>
