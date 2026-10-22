<script lang="ts">
  import { Icon, t, Banner } from '@skaro/ui';
  import type { C4PackageReview } from '@skaro/core/c4-view';
  import type { ProposalState } from './proposal-state.svelte';
  import LoadingIndicator from '../LoadingIndicator.svelte';
  import { architectureCounts } from './architecture-review';
  import './architecture-review-i18n';
  let { state: model }: { state: ProposalState } = $props();
  let review = $state.raw<C4PackageReview>();
  let error = $state('');
  const proposal = $derived(model.proposal.type === 'architecture' ? model.proposal : undefined);
  $effect(() => {
    const id = model.item.id;
    let current = true;
    review = undefined;
    error = '';
    void model.feed.architectureReview?.(id).then(
      (value) => {
        if (current) review = value;
      },
      (reason) => {
        if (current) error = String(reason);
      },
    );
    return () => {
      current = false;
    };
  });
</script>

{#if proposal}
  <div class="card flush" data-architecture-proposal>
    <div class="head">
      <Icon name="file" size={14} /><span class="title">{proposal.title}</span>
    </div>
    <div class="package-summary">
      <p class="description">
        {proposal.summary.slice(0, 1200)}{proposal.summary.length > 1200 ? '…' : ''}
      </p>
      <div class="facts">
        {#if error}<Banner kind="error" text={error} />
        {:else if review}
          <span>{t('c4.review.documents', { n: review.documents.length })}</span>
          <span>{architectureCounts(review)}</span>
          {#if review.generated.length}<span
              >{t('c4.review.generated', { n: review.generated.length })}</span
            >{/if}
        {:else}<LoadingIndicator size={16} />{/if}
      </div>
    </div>
    <div class="foot">
      <span class="hint"
        >{model.item.result?.error ??
          (model.item.state === 'accepted'
            ? t('c4.applying')
            : t(`c4.review.${model.item.state}`))}</span
      >
      <button type="button" class="btn" onclick={() => (model.viewer = true)}
        ><Icon name="eye" size={13} />{t('proposal.open')}</button
      >
      {#if model.actionable && model.item.state === 'pending'}
        <button
          type="button"
          class="btn"
          disabled={model.busy}
          onclick={() => void model.decide({ action: 'reject' })}
          ><Icon name="close" size={13} />{t('proposal.reject')}</button
        >
      {/if}
      {#if model.actionable && (model.item.state === 'pending' || (model.item.state === 'accepted' && model.item.result?.error))}
        <button
          type="button"
          class="btn primary"
          disabled={model.busy || !review}
          onclick={() => void model.decide({ action: 'apply', fingerprint: review?.fingerprint })}
          ><Icon name="check" size={13} />{t('proposal.apply')}</button
        >
      {/if}
    </div>
  </div>
{/if}

<style>
  .package-summary {
    padding: 0 13px 10px;
  }
  .description {
    margin: 0 0 8px;
    color: var(--sk-text-reply);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .facts {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 72px;
    color: var(--sk-text-23);
    font-size: var(--sk-fs-4);
  }
</style>
