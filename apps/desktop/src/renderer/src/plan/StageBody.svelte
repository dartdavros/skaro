<script lang="ts">
  import { t } from '@skaro/ui';
  import TaskRow from './TaskRow.svelte';
  import type { StageController } from './stage-controller.svelte';
  let { model }: { model: StageController } = $props();
  const slotH = $derived(model.slot?.h || 38);
</script>

<div data-plan-stage class="body">
  {#if model.m.goal || model.m.criteria}
    <div data-plan-stage class="meta">
      <div data-plan-stage class="meta-col">
        <span data-plan-stage class="label">{t('plan.goal')}</span>
        <span data-plan-stage class="text">{model.m.goal ?? ''}</span>
      </div>
      <div data-plan-stage class="meta-col">
        <span data-plan-stage class="label">{t('plan.criteria')}</span>
        <span data-plan-stage class="text">{model.m.criteria ?? ''}</span>
      </div>
    </div>
  {/if}
  <div data-plan-stage class="rows" role="list" data-rows>
    {#each model.shown as task, i (task.id)}
      {#if model.slot && model.slot.index === i}
        <div data-plan-stage class="slot" style="height: {slotH}px"><span></span></div>
      {/if}
      <TaskRow
        {task}
        byId={model.p.byId}
        now={model.p.now}
        archived={model.p.archived}
        relation={model.relation(task)}
        faded={!!model.p.hovered &&
          model.p.hovered !== task.id &&
          !model.p.up.has(task.id) &&
          !model.p.down.has(task.id)}
        dropped={model.p.dropped === task.id}
        onenter={() => !model.p.drag && model.p.onhover(task.id)}
        onleave={() => model.p.onhover(undefined)}
        onopen={() => model.p.onopen(task.id)}
        onrestore={() => model.p.onrestore?.(task.id)}
        ondown={model.p.archived
          ? undefined
          : (e) => {
              model.p.onhover(undefined);
              model.p.ondown('task', task.id, model.m.id, e);
            }}
        onkey={model.p.archived ? undefined : (e) => model.p.onkey('task', task.id, model.m.id, e)}
      />
    {/each}
    {#if model.slot && model.slot.index >= model.shown.length}
      <div data-plan-stage class="slot" style="height: {slotH}px"><span></span></div>
    {/if}
    {#if !model.shown.length && !model.slot}
      <div data-plan-stage class="empty">{t('plan.empty.stage')}</div>
    {/if}
  </div>
</div>
