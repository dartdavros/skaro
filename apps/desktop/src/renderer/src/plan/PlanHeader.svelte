<script lang="ts">
  import { Checkbox, Icon, t, tn } from '@skaro/ui';
  import type { PlanController } from './plan-controller.svelte';
  let { model }: { model: PlanController } = $props();
</script>

<div data-plan-screen class="top">
  <div data-plan-screen class="titles">
    <div data-plan-screen>
      <h1 data-plan-screen>{t('plan.title')}</h1>
      {#if model.list.length}
        <div data-plan-screen class="sub">
          {t('plan.sub', {
            stages: tn('plan.stages', model.list.length),
            done: model.done,
            total: model.total,
          })}
        </div>
      {/if}
    </div>
    <div data-plan-screen class="actions">
      <button
        data-plan-screen
        type="button"
        class="secondary"
        data-tip={t('plan.replan.tip')}
        onclick={model.p.onchat}
        ><Icon name="chat" size={14} stroke={1.9} />{t('plan.replan')}</button
      >
      <button
        data-plan-screen
        type="button"
        class="primary"
        onclick={() => (model.modal = { kind: 'new' })}
        ><Icon name="plus" size={14} stroke={2.6} />{t('plan.new')}</button
      >
    </div>
  </div>
  {#if model.list.length}
    <div data-plan-screen class="tools">
      <div
        data-plan-screen
        class="hide"
        role="checkbox"
        aria-checked={model.hideDone}
        tabindex="0"
        data-tip={t('plan.hideDone.tip')}
        onclick={() => (model.hideDone = !model.hideDone)}
        onkeydown={(e) => e.key === 'Enter' && (model.hideDone = !model.hideDone)}
      >
        <span data-plan-screen class="box"><Checkbox checked={model.hideDone} /></span>{t(
          'plan.hideDone',
        )}
      </div>
      <div data-plan-screen class="spacer"></div>
      <button
        data-plan-screen
        type="button"
        class="all"
        data-tip={model.anyOpen ? t('plan.collapseAll') : t('plan.expandAll')}
        onclick={() =>
          (model.openMap = model.anyOpen
            ? {}
            : Object.fromEntries(model.list.map((s) => [s.milestone.id, true])))}
        ><Icon name={model.anyOpen ? 'collapseAll' : 'expandAll'} size={16} stroke={1.9} /></button
      >
    </div>
  {/if}
</div>
