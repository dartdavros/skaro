<script lang="ts">
  import { ActionMenu, Icon, t } from '@skaro/ui';
  import type { StageController } from './stage-controller.svelte';
  let { model }: { model: StageController } = $props();
</script>

<div
  data-plan-stage
  class="head"
  role="button"
  tabindex="0"
  draggable={!model.p.stage.loose}
  onclick={model.p.ontoggle}
  onkeydown={(e) => e.key === 'Enter' && model.p.ontoggle()}
  ondragstart={(e) => !model.p.stage.loose && model.start(e, { kind: 'stage', id: model.m.id })}
  ondragend={() => model.p.ondrag(undefined)}
>
  {#if model.p.stage.loose}
    <span data-plan-stage class="grip-space"></span>
  {:else}
    <span data-plan-stage class="grip" data-tip={t('plan.dragStage')}
      ><Icon name="grip" size={14} stroke={2} /></span
    >
  {/if}
  <span data-plan-stage class="chev" class:open={model.p.open}
    ><Icon name="chevronRight" size={14} stroke={2.2} /></span
  >
  <span data-plan-stage class="id">{model.m.id}</span>
  <span data-plan-stage class="name" class:finished={model.finished}>{model.m.title}</span>
  <div data-plan-stage class="marks">
    {#if model.p.stage.working}
      <span
        data-plan-stage
        class="mark"
        data-tip={t('plan.mark.working', { n: model.p.stage.working })}
        ><span data-plan-stage class="dot working"></span>{model.p.stage.working}</span
      >
    {/if}
    {#if model.p.stage.attention}
      <span
        data-plan-stage
        class="mark"
        data-tip={t('plan.mark.attention', { n: model.p.stage.attention })}
        ><span data-plan-stage class="dot"></span>{model.p.stage.attention}</span
      >
    {/if}
    {#if model.p.stage.errors}
      <span
        data-plan-stage
        class="mark"
        data-tip={t('plan.mark.error', { n: model.p.stage.errors })}
        ><span data-plan-stage class="dot error"></span>{model.p.stage.errors}</span
      >
    {/if}
  </div>
  <div
    data-plan-stage
    class="progress"
    data-tip={model.pct === 100
      ? t('plan.progress.done')
      : t('plan.progress.tip', { done: model.p.stage.done, total: model.p.stage.total })}
  >
    <div data-plan-stage class="track">
      <div
        data-plan-stage
        class="fill"
        class:full={model.pct === 100}
        style="width: {model.pct}%"
      ></div>
    </div>
    <span data-plan-stage class="count"
      >{t('plan.progress', { done: model.p.stage.done, total: model.p.stage.total })}</span
    >
  </div>
  <!-- The menu does not toggle the milestone. -->
  {#if model.p.stage.loose}
    <span data-plan-stage class="menu-space"></span>
  {:else}
    <div data-plan-stage class="menu" role="presentation" onclick={(e) => e.stopPropagation()}>
      <ActionMenu
        size="row"
        align="right"
        width={222}
        tip={t('plan.menu')}
        items={[
          {
            label: t('plan.menu.newTask'),
            icon: 'plus',
            tip: t('plan.menu.newTask.tip'),
            onselect: () => model.p.onmenu('newTask'),
          },
          { label: t('plan.menu.edit'), icon: 'edit', onselect: () => model.p.onmenu('edit') },
          { label: t('plan.discuss'), icon: 'chat', onselect: () => model.p.onmenu('discuss') },
          'separator',
          {
            label: t('plan.menu.delete'),
            icon: 'trashRound',
            danger: true,
            onselect: () => model.p.onmenu('delete'),
          },
        ]}
      />
    </div>
  {/if}
</div>
