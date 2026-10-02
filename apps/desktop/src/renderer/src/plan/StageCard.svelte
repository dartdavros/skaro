<script lang="ts">
  import type { StageProps } from './stage-props';
  import { createStageController } from './stage-controller.svelte';
  import StageHeader from './StageHeader.svelte';
  import StageBody from './StageBody.svelte';
  import './stage-card.css';
  let p: StageProps = $props();
  const model = createStageController(() => p);
</script>

<div
  data-plan-stage
  class="stage"
  class:ring={model.stageOver}
  class:dragged={model.p.drag?.kind === 'stage' && model.p.drag.id === model.m.id}
  role="listitem"
  ondragover={model.overStage}
  ondrop={(e) => {
    e.preventDefault();
    model.p.ondrop();
  }}
>
  <StageHeader {model} />
  {#if model.p.open}
    <StageBody {model} />
  {/if}
</div>
