<script lang="ts">
  import { isAgentId } from '@skaro/agents/catalog';
  import { AgentLogo, Icon, ViewSwitch, t } from '@skaro/ui';
  import type { MilestoneInfo } from '../../../shared/ipc';
  import type { TaskFacets } from '../../../shared/task-catalog';
  import FilterDrop from './FilterDrop.svelte';
  import { toolbarOptions } from './toolbar-options';
  import { STATUS_META, type BoardStatus, type Filters } from './model';

  /**
   * Search, the milestone / status / agent filters, "Выбрать несколько" and the board-list
   * switch (Tasks mockup).
   */
  let {
    facets,
    milestones,
    filters = $bindable(),
    view = $bindable(),
    selecting,
    onselecting,
  }: {
    facets?: TaskFacets;
    milestones: MilestoneInfo[];
    filters: Filters;
    view: 'board' | 'list';
    selecting: boolean;
    onselecting: () => void;
  } = $props();

  const options = $derived(toolbarOptions(milestones, facets));
  const any = $derived(
    filters.milestones.length + filters.statuses.length + filters.agents.length > 0,
  );

  import './toolbar.css';
</script>

<div data-task-toolbar class="bar">
  <div data-task-toolbar class="search">
    <span data-task-toolbar class="glass"
      ><Icon name="search" size={14} stroke={2} color="var(--sk-text-18)" /></span
    >
    <input
      data-task-toolbar
      type="text"
      placeholder={t('board.search')}
      bind:value={filters.query}
    />
  </div>

  <FilterDrop
    label={t('board.f.milestone')}
    options={options.msOptions}
    bind:selected={filters.milestones}
    width={226}
  >
    {#snippet marker(id: string)}<span data-task-toolbar class="ms-id">{id}</span>{/snippet}
  </FilterDrop>
  <FilterDrop
    label={t('board.f.status')}
    options={options.stOptions}
    bind:selected={filters.statuses}
    width={214}
  >
    {#snippet marker(s: BoardStatus)}<span
        data-task-toolbar
        class="dot"
        style="background: {STATUS_META[s].color}"
      ></span>{/snippet}
  </FilterDrop>
  <FilterDrop
    label={t('board.f.agent')}
    options={options.agOptions}
    bind:selected={filters.agents}
    width={206}
  >
    {#snippet marker(a: string)}
      <span data-task-toolbar class="logo">
        {#if isAgentId(a)}
          <AgentLogo agent={a} size={12} />
        {:else}
          <svg
            data-task-toolbar
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--sk-text-22)"
            stroke-width="2"
            ><circle data-task-toolbar cx="12" cy="12" r="8" stroke-dasharray="3 3" /></svg
          >
        {/if}
      </span>
    {/snippet}
  </FilterDrop>

  {#if any}
    <button
      data-task-toolbar
      type="button"
      class="reset"
      onclick={() => (filters = { ...filters, milestones: [], statuses: [], agents: [] })}
      >{t('board.reset')}</button
    >
  {/if}

  <button
    data-task-toolbar
    type="button"
    class="pick"
    class:on={selecting}
    aria-pressed={selecting}
    onclick={onselecting}
  >
    <Icon name="tasks" size={13} stroke={2} />{t('board.pick')}
  </button>

  <div data-task-toolbar class="spacer"></div>
  <ViewSwitch
    value={view}
    options={[
      { id: 'board', label: t('board.view.board'), icon: 'board' },
      { id: 'list', label: t('board.view.list'), icon: 'list' },
    ]}
    onchange={(next) => (view = next as 'board' | 'list')}
  />
</div>
