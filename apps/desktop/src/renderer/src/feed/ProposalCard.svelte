<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import { ProposalState } from './proposal-state.svelte';
  import ProposalSummary from './ProposalSummary.svelte';
  import ProposalDocument from './ProposalDocument.svelte';
  import ProposalAdr from './ProposalAdr.svelte';
  import ProposalImport from './ProposalImport.svelte';
  import ProposalPlan from './ProposalPlan.svelte';
  import ProposalDialogs from './ProposalDialogs.svelte';
  import './proposal-card.css';
  import './proposal-plan.css';
  let { row }: { row: Extract<FeedRow, { type: 'proposal' }> } = $props();
  const state = new ProposalState(() => row);
</script>

<div class="proposal" id="proposal-{state.item.id}">
  {#if state.summaryLine}<ProposalSummary {state} />{:else if state.diff}<ProposalDocument
      {state}
    />{:else if state.proposal.type === 'adr' || state.proposal.type === 'spec'}<ProposalAdr
      {state}
    />{:else if state.proposal.type === 'import'}<ProposalImport
      {state}
    />{:else if state.plan}<ProposalPlan {state} />{/if}
</div>
<ProposalDialogs {state} />
