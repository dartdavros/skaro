<script lang="ts">
  import type { TimelineState } from '@skaro/timeline';
  import { pendingProposals } from '../../../shared/feed-actions';
  import FormCard from './FormCard.svelte';
  import LoginCard from './LoginCard.svelte';
  import MergeCard from './MergeCard.svelte';
  import PermissionCard from './PermissionCard.svelte';
  import PlanCard from './PlanCard.svelte';
  import ProposalCard from './ProposalCard.svelte';
  import QuestionCard from './QuestionCard.svelte';

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
      {#if interaction.kind === 'question'}<QuestionCard {interaction} />
      {:else if interaction.kind === 'approval'}
        <PermissionCard {interaction} primary={interaction.id === firstApproval} />
      {:else if interaction.kind === 'plan_approval'}<PlanCard {interaction} />
      {:else if interaction.kind === 'form'}<FormCard {interaction} />
      {:else if interaction.kind === 'login'}<LoginCard {interaction} />
      {:else if interaction.kind === 'merge'}
        <MergeCard {interaction} defaultMessage={interaction.message ?? mergeMessage} />
      {/if}
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
