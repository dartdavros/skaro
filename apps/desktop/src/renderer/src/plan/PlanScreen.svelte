<script lang="ts">
  import type { PlanProps } from './plan-props';
  import { createPlanController } from './plan-controller.svelte';
  import DeleteStage from './DeleteStage.svelte';
  import PlanHeader from './PlanHeader.svelte';
  import PlanEmpty from './PlanEmpty.svelte';
  import PlanStages from './PlanStages.svelte';
  import './i18n';
  import './plan-screen.css';
  let p: PlanProps = $props();
  const model = createPlanController(() => p);
</script>

<div data-plan-screen class="screen">
  <PlanHeader {model} />

  {#if model.p.data.loaded && !model.list.length}
    <PlanEmpty {model} />
  {:else}
    <PlanStages {model} />
  {/if}
</div>

{#if model.modal?.kind === 'delete'}
  {@const m = model.modal.milestone}
  <DeleteStage
    milestone={m}
    tasks={model.p.data.tasks.filter((x) => x.milestone?.id === m.id).length}
    onconfirm={() => void model.remove(m)}
    onclose={() => (model.modal = undefined)}
  />
{/if}
