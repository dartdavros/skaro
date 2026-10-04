<script lang="ts">
  import { Icon, t, tn } from '@skaro/ui';
  import type { PlanController } from './plan-controller.svelte';
  let { model }: { model: PlanController } = $props();
</script>

<div data-plan-screen class="top">
  <div data-plan-screen class="titles">
    <div data-plan-screen>
      <h1 data-plan-screen>{t('plan.title')}</h1>
      {#if model.list.length}
        <div data-plan-screen class="sub">
          {t(model.archiveView ? 'plan.sub.archive' : 'plan.sub', {
            stages: tn('plan.stages', model.list.filter((s) => !s.loose).length),
            done: model.done,
            total: model.total,
          })}
        </div>
      {/if}
    </div>
    <!-- An empty plan has the same action in the middle of the screen. -->
    {#if model.list.length}
      <div data-plan-screen class="actions">
        <button
          data-plan-screen
          type="button"
          class="secondary"
          data-tip={t('plan.discuss.tip')}
          onclick={model.p.onchat}
          ><Icon name="chat" size={14} stroke={1.9} />{t('plan.discuss')}</button
        >
      </div>
    {/if}
  </div>
  {#if model.list.length || model.archived.length}
    <div data-plan-screen class="tools">
      <div data-plan-screen class="spacer"></div>
      {#if model.archived.length}
        <button
          data-plan-screen
          type="button"
          class="all"
          class:on={model.archiveView}
          aria-pressed={model.archiveView}
          data-tip={model.archiveTip}
          aria-label={model.archiveTip}
          onclick={() => (model.archiveView = !model.archiveView)}
          ><Icon name="archive" size={16} stroke={1.8} /></button
        >
      {/if}
      {#if model.list.length}
        <button
          data-plan-screen
          type="button"
          class="all"
          data-tip={model.anyOpen ? t('plan.collapseAll') : t('plan.expandAll')}
          onclick={() =>
            (model.openMap = model.anyOpen
              ? {}
              : Object.fromEntries(model.list.map((s) => [s.milestone.id, true])))}
          ><Icon
            name={model.anyOpen ? 'collapseAll' : 'expandAll'}
            size={16}
            stroke={1.9}
          /></button
        >
      {/if}
    </div>
  {/if}
</div>
