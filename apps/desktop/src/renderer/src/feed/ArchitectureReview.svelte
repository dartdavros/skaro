<script lang="ts">
  import { ViewerModal, Select, Segmented, IconButton, Icon, Banner, t } from '@skaro/ui';
  import type { C4Model, C4PackageReview } from '@skaro/core/c4-view';
  import { useFeed } from './context.svelte';
  import { architectureEntries, reviewedView } from './architecture-review';
  import ArchitectureReviewDetail from './ArchitectureReviewDetail.svelte';
  import LoadingIndicator from '../LoadingIndicator.svelte';
  import C4Viewer from '../c4/C4Viewer.svelte';
  import './architecture-review-i18n';
  let { itemId, title, onclose }: { itemId: string; title: string; onclose: () => void } = $props();
  const feed = useFeed();
  let review = $state.raw<C4PackageReview>();
  let error = $state('');
  let selected = $state('');
  let mode = $state<'changes' | 'before' | 'after'>('changes');
  let model = $state.raw<C4Model>();
  let opening = $state(false);
  let closed = false;
  $effect(() => {
    closed = false;
    let current = true;
    void feed.architectureReview?.(itemId).then(
      (value) => {
        if (current) {
          review = value;
          selected = architectureEntries(value)[0]?.value ?? '';
        }
      },
      (reason) => {
        if (current) error = String(reason);
      },
    );
    return () => {
      current = false;
      closed = true;
    };
  });
  const entries = $derived(review ? architectureEntries(review) : []);
  async function openC4() {
    opening = true;
    try {
      const value = await feed.architectureReviewModel?.(
        itemId,
        mode === 'before' ? 'before' : 'after',
      );
      if (!closed) model = value ?? undefined;
    } catch (reason) {
      if (!closed) error = String(reason);
    } finally {
      opening = false;
    }
  }
</script>

<ViewerModal label={title} expanded {onclose}>
  <div class="review-head">
    <span class="review-title">{title}</span>
    <IconButton tip={t('ui.close')} onclick={onclose}><Icon name="close" size={16} /></IconButton>
  </div>
  {#if error}<Banner kind="error" text={error} />{/if}
  {#if review}
    <div class="review-controls">
      <Select
        options={entries}
        bind:value={selected}
        label={t('c4.review.select')}
        width="min(480px, 50vw)"
      />
      <Segmented
        bind:value={mode}
        options={(['changes', 'before', 'after'] as const).map((value) => ({
          value,
          label: t(`c4.review.${value}`),
        }))}
      />
      <IconButton tip={t('c4.review.diagram')} disabled={opening} onclick={() => void openC4()}
        ><Icon name="network" size={16} /></IconButton
      >
    </div>
    <div class="revision">
      {t('c4.review.revision', { before: review.baseRevision, after: review.revision })}
    </div>
    {#if selected}<ArchitectureReviewDetail {itemId} {selected} {mode} />{/if}
  {:else if !error}<div class="review-loading"><LoadingIndicator /></div>{/if}
</ViewerModal>
{#if model?.views.length}
  <C4Viewer
    {model}
    initialView={reviewedView(model, review, selected)}
    onclose={() => (model = undefined)}
  />
{/if}

<style>
  .review-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 18px;
    border-bottom: 1px solid var(--sk-fill-27);
  }
  .review-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--sk-text-reply);
  }
  .review-controls {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 12px 18px;
  }
  .revision {
    padding: 0 18px 12px;
    color: var(--sk-text-23);
    font-size: var(--sk-fs-4);
  }
  .review-loading {
    min-height: 240px;
    display: grid;
    place-items: center;
  }
</style>
