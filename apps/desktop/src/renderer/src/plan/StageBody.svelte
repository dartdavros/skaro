<script lang="ts">
  import { t } from '@skaro/ui';
  import TaskRow from './TaskRow.svelte';
  import type { StageController } from './stage-controller.svelte';
  let { model }: { model: StageController } = $props();
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
  <div data-plan-stage class="rows" role="list">
    {#each model.shown as task (task.id)}
      {@const at = model.p.stage.tasks.indexOf(task)}
      <TaskRow
        {task}
        byId={model.p.byId}
        now={model.p.now}
        relation={model.relation(task)}
        faded={!!model.p.hovered &&
          model.p.hovered !== task.id &&
          !model.p.up.has(task.id) &&
          !model.p.down.has(task.id)}
        dragged={model.p.drag?.kind === 'task' && model.p.drag.id === task.id}
        dropLine={model.p.drag?.kind === 'task' &&
          model.p.drag.id !== task.id &&
          model.p.over?.kind === 'task' &&
          model.p.over.stage === model.m.id &&
          model.p.over.index === at}
        onenter={() => !model.p.drag && model.p.onhover(task.id)}
        onleave={() => model.p.onhover(undefined)}
        onopen={() => model.p.onopen(task.id)}
        ondragstart={(e) => {
          model.p.onhover(undefined);
          model.start(e, { kind: 'task', id: task.id });
        }}
        ondragover={(e) => {
          if (model.p.drag?.kind !== 'task') return;
          e.preventDefault();
          e.stopPropagation();
          model.p.onover({ kind: 'task', stage: model.m.id, index: at });
        }}
        ondrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          model.p.ondrop();
        }}
        ondragend={() => model.p.ondrag(undefined)}
      />
    {/each}
    {#if !model.shown.length}
      <div
        data-plan-stage
        class="empty"
        class:drop={model.endOver}
        role="presentation"
        ondragover={model.overEnd}
      >
        {model.p.stage.tasks.length
          ? t('plan.allDone', { n: model.p.stage.tasks.length - model.shown.length })
          : t('plan.empty.stage')}
      </div>
    {/if}
    <div
      data-plan-stage
      class="end"
      class:drop={model.endOver && model.shown.length > 0}
      role="presentation"
      ondragover={model.overEnd}
    ></div>
  </div>
</div>
