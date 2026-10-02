<script lang="ts">
  import type { PlanProps } from './plan-props';
  import { createPlanController } from './plan-controller.svelte';
  import { heirOf } from './model';
  import DeleteStage from './DeleteStage.svelte';
  import PlanHeader from './PlanHeader.svelte';
  import PlanEmpty from './PlanEmpty.svelte';
  import PlanStages from './PlanStages.svelte';
  import StageModal from './StageModal.svelte';
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

{#if model.modal?.kind === 'new' || model.modal?.kind === 'edit'}
  <StageModal
    milestone={model.modal.kind === 'edit' ? model.modal.milestone : undefined}
    onsave={(input) => void model.save(input)}
    onclose={() => (model.modal = undefined)}
  />
{:else if model.modal?.kind === 'delete'}
  {@const m = model.modal.milestone}
  <DeleteStage
    milestone={m}
    tasks={model.list.find((s) => s.milestone.id === m.id)?.tasks.length ?? 0}
    heir={heirOf(model.p.data.milestones, m.id)}
    onconfirm={() => void model.remove(m)}
    onclose={() => (model.modal = undefined)}
  />
{/if}
