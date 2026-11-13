<script lang="ts">
  import type { TimelineState } from '@skaro/timeline';
  import { pendingProposals } from '../../../shared/feed-actions';
  import InteractionCard from './InteractionCard.svelte';
  import ProposalCard from './ProposalCard.svelte';

  let {
    timeline,
    mergeMessage = '',
  }: { timeline: TimelineState; mergeMessage?: string | undefined } = $props();
  const proposals = $derived(pendingProposals(timeline.items));
  const firstApproval = $derived(timeline.interactions.find((i) => i.kind === 'approval')?.id);
</script>

{#if timeline.interactions.length || proposals.length}
  <div class="pending-actions" data-pending-actions>
    {#each proposals as item (item.id)}
      <ProposalCard row={{ type: 'proposal', id: item.id, item }} />
    {/each}
    {#each timeline.interactions as interaction (interaction.id)}
      <InteractionCard {interaction} primary={interaction.id === firstApproval} {mergeMessage} />
    {/each}
  </div>
{/if}

<style>
  .pending-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 45vh;
    overflow-y: auto;
    flex: none;
  }
  .pending-actions > :global(*) {
    flex: none;
  }
  .pending-actions :global(.proposal .foot) {
    position: sticky;
    bottom: 0;
    background: var(--sk-surface);
    z-index: 1;
  }
  .pending-actions :global(.proposal .card.flush) {
    overflow: clip;
  }
</style>
