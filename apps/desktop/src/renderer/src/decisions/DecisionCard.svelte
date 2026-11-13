<script lang="ts">
  import { Button, t } from '@skaro/ui';
  import { ArrowUpRight, MessageSquare, RefreshCw, RotateCw } from '@lucide/svelte';
  import ImageViewer from '../feed/ImageViewer.svelte';
  import LoadingIndicator from '../LoadingIndicator.svelte';
  import { provideFeed } from '../feed/context.svelte';
  import InteractionCard from '../feed/InteractionCard.svelte';
  import ProposalCard from '../feed/ProposalCard.svelte';
  import { decisionFeedActions } from './feed-actions';
  import type { DecisionCardState } from './card-state.svelte';
  import type { DecisionOrigin } from '../../../shared/project-decisions';
  let {
    card,
    primary,
    onopen,
  }: {
    card: DecisionCardState;
    primary: boolean;
    onopen: (origin: DecisionOrigin, importId?: string) => void;
  } = $props();
  let image = $state<string>();
  // The keyed parent preserves this card's source identity.
  // svelte-ignore state_referenced_locally
  provideFeed(
    decisionFeedActions(card, onopen, (src) => {
      image = src;
    }),
  );
  const entry = $derived(card.entry!);
  const terminal = $derived(['stale', 'expired', 'answered', 'denied'].includes(card.status));
</script>

<article class="decision-card" data-project-decision={entry.id}>
  <div class="source">
    <span>{t(`decisions.${entry.origin.kind}`)} · {entry.origin.title}</span>
    <button onclick={() => onopen(entry.origin)}
      >{#if entry.origin.kind === 'task'}<ArrowUpRight size={16} />{:else}<MessageSquare
          size={16}
        />{/if}{t(
        entry.origin.kind === 'task' ? 'decisions.openTask' : 'decisions.openChat',
      )}</button
    >
  </div>
  {#if !terminal}
    <div inert={card.status === 'sending'}>
      {#if entry.kind === 'interaction'}<InteractionCard
          interaction={entry.interaction}
          {primary}
        />
      {:else}<ProposalCard row={{ type: 'proposal', id: entry.item.id, item: entry.item }} />{/if}
    </div>
  {/if}
  <div class="status" class:error={card.status === 'error'} role="status">
    {#if card.status === 'sending'}<LoadingIndicator size={16} /><span
        >{t('decisions.sending')}</span
      >
    {:else if card.status !== 'pending'}<span>{t(`decisions.${card.status}`)}</span>{/if}
    {#if card.status === 'error'}<Button size="sm" onclick={() => void card.repeat()}
        ><RotateCw size={16} />{t('decisions.retry')}</Button
      >
    {:else if card.status === 'stale'}<Button
        size="sm"
        onclick={() => card.update()}
        disabled={!card.latest}><RefreshCw size={16} />{t('decisions.update')}</Button
      >{/if}
  </div>
</article>
<ImageViewer bind:src={image} />

<style>
  .decision-card {
    flex: none;
    min-height: 112px;
  }
  .source {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    font-size: var(--sk-fs-4);
    color: var(--sk-text-muted);
    margin-bottom: 8px;
  }
  .source button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    border: none;
    background: none;
    color: var(--sk-link);
    font: inherit;
    cursor: pointer;
  }
  .status {
    min-height: 28px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--sk-fs-4);
    color: var(--sk-text-secondary);
  }
  .status.error {
    color: var(--sk-error);
  }
  .status :global(button) {
    margin-left: auto;
  }
</style>
