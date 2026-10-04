<script lang="ts">
  import StageCard from './StageCard.svelte';
  import TaskRow from './TaskRow.svelte';
  import { canArchive, canDelete, type Stage } from './model';
  import type { PlanController } from './plan-controller.svelte';
  let { model }: { model: PlanController } = $props();

  const drag = $derived(model.dnd.drag);
  // The dragged milestone leaves the list; its slot moves among the other milestones.
  const items = $derived(
    model.list.filter((s) => !(drag?.kind === 'stage' && s.milestone.id === drag.id)),
  );
  const movable = $derived(items.filter((s) => !s.loose).length);
  const slotAt = (stage: Stage, i: number): boolean =>
    drag?.kind === 'stage' && (stage.loose ? drag.index >= movable : drag.index === i);
  const ghostStage = $derived(
    drag && !drag.keyboard && drag.kind === 'stage'
      ? model.list.find((s) => s.milestone.id === drag.id)
      : undefined,
  );
  const ghostTask = $derived(
    drag && !drag.keyboard && drag.kind === 'task' ? model.byId.get(drag.id) : undefined,
  );
</script>

<div data-plan-screen class="stages" role="list" bind:this={model.root}>
  {#each items as stage, i (stage.milestone.id)}
    {#if slotAt(stage, i)}
      <div data-plan-screen class="slot" style="height: {drag?.h || 56}px"><span></span></div>
    {/if}
    <StageCard
      {stage}
      archived={model.archiveView}
      open={!!model.openMap?.[stage.milestone.id]}
      hovered={model.hovered}
      up={model.rel.up}
      down={model.rel.down}
      byId={model.byId}
      {drag}
      dropped={model.dnd.dropped}
      now={model.now}
      canArchive={canArchive(stage)}
      canDelete={canDelete(stage.milestone.id, model.p.data.tasks)}
      ontoggle={() => model.toggle(stage.milestone.id)}
      onmenu={(action) => {
        if (action === 'archive') model.setArchived(stage, true);
        else if (action === 'restore') model.setArchived(stage, false);
        else if (action === 'delete') model.modal = { kind: 'delete', milestone: stage.milestone };
        else model.p.onchat();
      }}
      onhover={(id) => (model.hovered = id)}
      onopen={model.p.onopen}
      onrestore={model.restoreTask}
      ondown={model.dnd.down}
      onkey={model.dnd.keydown}
    />
  {/each}
  {#if drag?.kind === 'stage' && !items.some((s) => s.loose) && drag.index >= movable}
    <div data-plan-screen class="slot" style="height: {drag.h || 56}px"><span></span></div>
  {/if}
  {#if ghostStage && drag}
    <div
      data-plan-screen
      class="ghost"
      style="left: {drag.x - drag.ox}px; top: {drag.y - drag.oy}px; width: {drag.w}px"
    >
      <StageCard
        stage={ghostStage}
        ghost
        open={false}
        up={model.rel.up}
        down={model.rel.down}
        byId={model.byId}
        now={model.now}
        canArchive={false}
        canDelete={false}
        ontoggle={() => undefined}
        onmenu={() => undefined}
        onhover={() => undefined}
        onopen={() => undefined}
        ondown={() => undefined}
        onkey={() => undefined}
      />
    </div>
  {/if}
  {#if ghostTask && drag}
    <div
      data-plan-screen
      class="ghost"
      style="left: {drag.x - drag.ox}px; top: {drag.y - drag.oy}px; width: {drag.w}px"
    >
      <TaskRow task={ghostTask} byId={model.byId} now={model.now} ghost />
    </div>
  {/if}
  <div data-plan-screen class="live" aria-live="assertive">{model.dnd.live}</div>
</div>
