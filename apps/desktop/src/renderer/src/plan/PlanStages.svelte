<script lang="ts">
  import StageCard from './StageCard.svelte';
  import type { PlanController } from './plan-controller.svelte';
  let { model }: { model: PlanController } = $props();
</script>

<div data-plan-screen class="stages" role="list">
  {#each model.list as stage, index (stage.milestone.id)}
    <StageCard
      {stage}
      {index}
      open={!!model.openMap?.[stage.milestone.id]}
      hideDone={model.hideDone}
      hovered={model.hovered}
      up={model.rel.up}
      down={model.rel.down}
      byId={model.byId}
      drag={model.drag}
      over={model.over}
      now={model.now}
      ontoggle={() => model.toggle(stage.milestone.id)}
      onmenu={(action) => {
        if (action === 'edit') model.modal = { kind: 'edit', milestone: stage.milestone };
        else if (action === 'delete') model.modal = { kind: 'delete', milestone: stage.milestone };
        else model.p.onchat();
      }}
      onhover={(id) => (model.hovered = id)}
      onopen={model.p.onopen}
      ondrag={(d) => {
        model.drag = d;
        if (!d) model.over = undefined;
      }}
      onover={(o) => (model.over = o)}
      ondrop={model.drop}
    />
  {/each}
</div>
