<script lang="ts">
  import type { C4Model, C4State, C4View, C4ViewKind } from '@skaro/core/c4-view';
  import C4ExportAll from './C4ExportAll.svelte';
  import C4AuditButton from './C4AuditButton.svelte';
  import { Icon, ViewSwitch, t } from '@skaro/ui';
  import FilterDrop from '../tasks/FilterDrop.svelte';
  import { viewKinds, viewKindIcons } from './view-kinds';
  import '../tasks/toolbar.css';
  import '../tasks/i18n';
  let {
    views,
    model,
    onexporterror,
    kinds = $bindable([]),
    states = $bindable([]),
    view,
    onviewchange,
  }: {
    views: C4View[];
    model: C4Model;
    onexporterror: (error: string) => void;
    kinds: C4ViewKind[];
    states: C4State[];
    view: string;
    onviewchange: (view: string) => void;
  } = $props();
  const kindOptions = $derived(
    viewKinds.map((kind) => ({
      value: kind,
      label: t(`c4.${kind}`),
      count: views.filter((item) => item.kind === kind).length,
    })),
  );
  const stateOptions = $derived(
    (['current', 'planned'] as const).map((state) => ({
      value: state,
      label: t(`c4.${state}`),
      count: views.filter((item) => item.state === state).length,
    })),
  );
</script>

<div data-task-toolbar class="bar">
  <FilterDrop label={t('c4.filter.kind')} options={kindOptions} bind:selected={kinds} width={226}>
    {#snippet marker(kind: C4ViewKind)}<Icon name={viewKindIcons[kind]} size={14} />{/snippet}
  </FilterDrop>
  <FilterDrop
    label={t('c4.filter.state')}
    options={stateOptions}
    bind:selected={states}
    width={260}
  >
    {#snippet marker()}{/snippet}
  </FilterDrop>
  {#if kinds.length || states.length}
    <button
      data-task-toolbar
      type="button"
      class="reset"
      onclick={() => {
        kinds = [];
        states = [];
      }}>{t('board.reset')}</button
    >
  {/if}
  <div data-task-toolbar class="spacer"></div>
  <C4AuditButton />
  <C4ExportAll {model} onerror={onexporterror} />
  <ViewSwitch
    value={view}
    options={[
      { id: 'list', label: t('c4.view.list'), icon: 'list' },
      { id: 'grid', label: t('c4.view.grid'), icon: 'board' },
    ]}
    onchange={onviewchange}
  />
</div>

<style>
  .bar {
    flex-wrap: wrap;
    margin-bottom: 18px;
  }
</style>
