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
  class:over={model.over}
  class:ghost={model.p.ghost}
  class:dropped={model.p.dropped === model.m.id}
  role="listitem"
  aria-hidden={model.p.ghost || undefined}
  data-stage={model.movable ? model.m.id : undefined}
  data-drop={model.p.ghost || model.p.archived ? undefined : model.m.id}
>
  <StageHeader {model} />
  {#if model.p.open}
    <StageBody {model} />
  {/if}
</div>
