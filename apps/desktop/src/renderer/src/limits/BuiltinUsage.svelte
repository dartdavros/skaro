<script lang="ts">
  import { Banner, t } from '@skaro/ui';
  import LoadingIndicator from '../LoadingIndicator.svelte';
  import Row from '../settings/Row.svelte';
  import type { ModelUsageSummary } from '../../../shared/model-usage';
  let {
    usage,
    loading,
    failed,
  }: {
    usage?: ModelUsageSummary;
    loading: boolean;
    failed: boolean;
  } = $props();
</script>

<div class="usage" aria-busy={loading}>
  {#if loading}
    <div class="loading"><LoadingIndicator /></div>
  {:else if failed}
    <Banner kind="error" text={t('limits.failed')} />
  {:else if usage}
    <Row title={t('models.requests')}><span>{usage.responses} / {usage.requests}</span></Row>
    <Row title={t('models.tokens')}
      ><span>{usage.knownInputTokens} / {usage.knownOutputTokens}</span></Row
    >
    <Row title={t('models.reportedCost')}>
      <span
        >{usage.reportedCost.map((cost) => `${cost.amount} ${cost.currency}`).join(' · ') ||
          '—'}</span
      >
    </Row>
    {#if usage.costsUnreported || usage.tokensUnreported || usage.unavailableSessions}
      <Banner kind="info" text={t('models.usageIncomplete')} />
    {/if}
  {/if}
</div>

<style>
  .usage {
    display: flex;
    flex-direction: column;
    gap: 18px;
    /* Three receipt rows, their gaps and the two-line incompleteness notice. */
    min-height: 252px;
  }
  .loading {
    display: grid;
    place-items: center;
    min-height: 252px;
  }
</style>
