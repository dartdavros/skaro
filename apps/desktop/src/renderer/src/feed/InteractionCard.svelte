<script lang="ts">
  import type { Interaction } from '@skaro/timeline';
  import QuestionCard from './QuestionCard.svelte';
  import PermissionCard from './PermissionCard.svelte';
  import PlanCard from './PlanCard.svelte';
  import FormCard from './FormCard.svelte';
  import LoginCard from './LoginCard.svelte';
  import MergeCard from './MergeCard.svelte';
  let {
    interaction,
    primary = true,
    mergeMessage = '',
  }: { interaction: Interaction; primary?: boolean; mergeMessage?: string } = $props();
</script>

{#if interaction.kind === 'question'}<QuestionCard {interaction} />
{:else if interaction.kind === 'approval'}<PermissionCard {interaction} {primary} />
{:else if interaction.kind === 'plan_approval'}<PlanCard {interaction} />
{:else if interaction.kind === 'form'}<FormCard {interaction} />
{:else if interaction.kind === 'login'}<LoginCard {interaction} />
{:else if interaction.kind === 'merge'}<MergeCard
    {interaction}
    defaultMessage={interaction.message ?? mergeMessage}
  />{/if}
