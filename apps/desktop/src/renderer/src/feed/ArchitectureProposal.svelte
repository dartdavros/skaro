<script lang="ts">
  import { Icon, IconButton, t, Banner } from '@skaro/ui';
  import { Check, FileCheck2, FolderOpen, RotateCw, X } from '@lucide/svelte';
  import type { C4PackageReview } from '@skaro/core/c4-view';
  import type { C4ApplicationOperation } from '../../../shared/c4-review';
  import type { ProposalState } from './proposal-state.svelte';
  import LoadingIndicator from '../LoadingIndicator.svelte';
  import { architectureCounts } from './architecture-review';
  import { cleanError } from './action-error';
  import './architecture-review-i18n';
  import '../c4/audit-i18n';
  let { state: model }: { state: ProposalState } = $props();
  let review = $state.raw<C4PackageReview>();
  let error = $state('');
  let application = $state<C4ApplicationOperation>();
  let applicationError = $state('');
  let unconfirmed = $state(false);
  const proposal = $derived(model.proposal.type === 'architecture' ? model.proposal : undefined);
  const canApply = $derived(
    model.actionable &&
      model.item.state === 'pending' &&
      model.feed.canApplyPendingArchitecture !== false,
  );
  const canRecover = $derived(
    model.feed.interactive &&
      model.feed.architectureApplication !== undefined &&
      model.item.state === 'accepted' &&
      !!model.item.result?.error,
  );
  async function recover(operation: C4ApplicationOperation) {
    if (!model.feed.architectureApplication || model.busy) return;
    model.busy = true;
    application = operation;
    applicationError = '';
    unconfirmed = false;
    try {
      unconfirmed = !(await model.feed.architectureApplication(model.item.id, operation));
    } catch (reason) {
      applicationError = cleanError(reason);
    } finally {
      application = undefined;
      model.busy = false;
    }
  }
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
      <span class="hint" aria-live="polite"
        >{(canRecover && (applicationError || (unconfirmed && t('c4.review.notApplied')))) ||
          model.item.result?.error ||
          (model.item.state === 'accepted'
            ? t('c4.applying')
            : t(`c4.review.${model.item.state}`))}</span
      >
      <button type="button" class="btn" onclick={() => (model.viewer = true)}
        ><FolderOpen size={16} />{t('proposal.open')}</button
      >
      {#if model.actionable && model.item.state === 'pending'}
        <button
          type="button"
          class="btn"
          disabled={model.busy}
          onclick={() => void model.decide({ action: 'reject' })}
          ><X size={16} />{t('proposal.reject')}</button
        >
      {/if}
      {#if canApply}
        <button
          type="button"
          class="btn primary"
          disabled={model.busy || !review}
          onclick={() => void model.decide({ action: 'apply', fingerprint: review?.fingerprint })}
          ><Check size={16} />{t('proposal.apply')}</button
        >
      {/if}
      {#if canRecover}
        <IconButton
          tip={t('c4.review.retryApplication')}
          disabled={model.busy}
          aria-busy={application === 'retry'}
          onclick={() => void recover('retry')}
        >
          {#if application === 'retry'}<LoadingIndicator size={16} />{:else}<RotateCw
              size={16}
            />{/if}
        </IconButton>
        <button
          type="button"
          class="btn primary"
          disabled={model.busy}
          aria-busy={application === 'check'}
          onclick={() => void recover('check')}
          >{#if application === 'check'}<LoadingIndicator size={16} />{:else}<FileCheck2
              size={16}
            />{/if}{t('c4.audit.recover')}</button
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
