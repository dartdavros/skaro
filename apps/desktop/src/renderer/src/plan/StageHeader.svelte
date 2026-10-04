<script lang="ts">
  import { ActionMenu, Icon, t } from '@skaro/ui';
  import type { StageController } from './stage-controller.svelte';
  import { doneLike, rowStatus } from './model';
  let { model }: { model: StageController } = $props();

  const left = $derived(model.p.stage.tasks.filter((x) => !doneLike(rowStatus(x.status))).length);
  const archiveTip = $derived(
    model.p.canArchive
      ? t('plan.menu.archive.tip')
      : model.p.stage.tasks.length
        ? t('plan.menu.archive.left', { n: left })
        : t('plan.menu.archive.empty'),
  );
  const items = $derived(
    model.p.archived
      ? [
          {
            label: t('plan.menu.restore'),
            icon: 'unarchive' as const,
            tip: t('plan.menu.restore.tip'),
            onselect: () => model.p.onmenu('restore'),
          },
        ]
      : [
          {
            label: t('plan.discuss'),
            icon: 'chat' as const,
            onselect: () => model.p.onmenu('discuss'),
          },
          {
            label: t('plan.menu.archive'),
            icon: 'archive' as const,
            tip: archiveTip,
            disabled: !model.p.canArchive,
            onselect: () => model.p.onmenu('archive'),
          },
          'separator' as const,
          {
            label: t('plan.menu.delete'),
            icon: 'trashRound' as const,
            danger: true,
            ...(model.p.canDelete ? {} : { tip: t('plan.menu.delete.started'), disabled: true }),
            onselect: () => model.p.onmenu('delete'),
          },
        ],
  );
</script>

<div
  data-plan-stage
  class="head"
  role="button"
  tabindex={model.p.ghost ? -1 : 0}
  aria-roledescription={model.movable ? t('plan.dnd.stage') : undefined}
  data-stage-head={model.p.ghost ? undefined : model.m.id}
  onclick={model.p.ontoggle}
  onkeydown={(e) => {
    if (e.key === 'Enter') model.p.ontoggle();
    else if (model.movable) model.p.onkey('stage', model.m.id, model.m.id, e);
  }}
  onpointerdown={(e) => model.movable && model.p.ondown('stage', model.m.id, model.m.id, e)}
>
  {#if model.movable || model.p.ghost}
    <span data-plan-stage class="grip" data-tip={t('plan.dragStage')}
      ><Icon name="grip" size={14} stroke={2} /></span
    >
  {:else}
    <span data-plan-stage class="grip-space"></span>
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
  <!-- The menu neither toggles nor drags the milestone. -->
  {#if model.p.stage.loose && !model.p.archived}
    <span data-plan-stage class="menu-space"></span>
  {:else}
    <div
      data-plan-stage
      class="menu"
      role="presentation"
      onclick={(e) => e.stopPropagation()}
      onpointerdown={(e) => e.stopPropagation()}
    >
      <ActionMenu size="row" align="right" width={222} tip={t('plan.menu')} {items} />
    </div>
  {/if}
</div>
