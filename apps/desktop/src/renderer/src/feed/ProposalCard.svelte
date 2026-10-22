<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import { onDestroy } from 'svelte';
  import { ProposalState } from './proposal-state.svelte';
  import ArchitectureProposal from './ArchitectureProposal.svelte';
  import ProposalSummary from './ProposalSummary.svelte';
  import ProposalDocument from './ProposalDocument.svelte';
  import ProposalAdr from './ProposalAdr.svelte';
  import ProposalImport from './ProposalImport.svelte';
  import ProposalPlan from './ProposalPlan.svelte';
  import ProposalDialogs from './ProposalDialogs.svelte';
  import './proposal-card.css';
  import './proposal-plan.css';
  let { row }: { row: Extract<FeedRow, { type: 'proposal' }> } = $props();
  const model = new ProposalState(() => row);
  let root = $state<HTMLDivElement>();
  $effect(() => {
    root?.dispatchEvent(
      new CustomEvent('feed-retain', {
        bubbles: true,
        detail: {
          id: model.item.id,
          active: model.viewer || model.editing || model.busy,
        },
      }),
    );
  });
  onDestroy(() => model.remember());
</script>

<div class="proposal" id="proposal-{model.item.id}" bind:this={root}>
  {#if model.proposal.type === 'architecture'}<ArchitectureProposal
      state={model}
    />{:else if model.summaryLine}<ProposalSummary
      state={model}
    />{:else if model.diff}<ProposalDocument
      state={model}
    />{:else if model.proposal.type === 'adr' || model.proposal.type === 'spec'}<ProposalAdr
      state={model}
    />{:else if model.proposal.type === 'import'}<ProposalImport
      state={model}
    />{:else if model.plan}<ProposalPlan state={model} />{/if}
</div>
<ProposalDialogs state={model} />
