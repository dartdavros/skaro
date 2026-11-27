<script lang="ts">
  import { Banner, Icon, IconButton, ViewerModal, t } from '@skaro/ui';
  import type { C4Model, C4PackageReview } from '@skaro/core/c4-view';
  import LoadingIndicator from '../LoadingIndicator.svelte';
  import C4Viewer from '../c4/C4Viewer.svelte';
  import { useFeed } from './context.svelte';
  import { reviewedView } from './architecture-review';
  import '../graph/i18n';

  let {
    itemId,
    side,
    selected,
    review,
    onclose,
  }: {
    itemId: string;
    side: 'before' | 'after';
    selected: string;
    review: C4PackageReview;
    onclose: () => void;
  } = $props();
  const feed = useFeed();
  let model = $state.raw<C4Model | null>();
  let error = $state('');
  $effect(() => {
    let current = true;
    void feed.architectureReviewModel?.(itemId, side).then(
      (value) => {
        if (current) model = value;
      },
      (reason: unknown) => {
        if (current) error = String(reason);
      },
    );
    return () => {
      current = false;
    };
  });
</script>

{#if model?.views.length}
  <C4Viewer {model} initialView={reviewedView(model, review, selected)} {onclose} />
{:else}
  <ViewerModal label={t('c4.review.diagram')} expanded {onclose}>
    <div class="status">
      <IconButton tip={t('ui.close')} onclick={onclose}><Icon name="close" size={16} /></IconButton>
      {#if error}<Banner kind="error" text={error} />
      {:else if model === undefined}<LoadingIndicator />
      {:else}<Banner kind="info" text={t('graph.noC4')} />{/if}
    </div>
  </ViewerModal>
{/if}

<style>
  .status {
    display: grid;
    min-height: 240px;
    place-content: center;
    gap: 12px;
  }
</style>
