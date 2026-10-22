<script lang="ts">
  import type { ProposalState } from './proposal-state.svelte';
  import Markdown from './Markdown.svelte';
  let { state: model }: { state: ProposalState } = $props();
  const text = $derived('after' in model.proposal ? (model.proposal.after ?? '') : '');
</script>

<Markdown {text} />
