<script lang="ts">
  import { AgentLogo, Icon, t } from '@skaro/ui';
  import type { MilestoneInfo, TaskSummary } from '../../../shared/ipc';
  import FilterDrop from './FilterDrop.svelte';
  import { boardStatus, STATUS_META, STATUS_ORDER, type BoardStatus, type Filters } from './model';

  /**
   * Search, the milestone / status / agent filters, "Выбрать несколько" and the board-list
   * switch (Tasks mockup).
   */
  let {
    tasks,
    milestones,
    filters = $bindable(),
    view = $bindable(),
    selecting,
    onselecting,
  }: {
    tasks: TaskSummary[];
    milestones: MilestoneInfo[];
    filters: Filters;
    view: 'board' | 'list';
    selecting: boolean;
    onselecting: () => void;
  } = $props();

  const msOptions = $derived([
    ...milestones.map((m) => ({
      value: m.id,
      label: m.title,
      short: m.id,
      count: tasks.filter((x) => x.milestone?.id === m.id).length,
    })),
    // "Без этапа": tasks without a milestone.
    {
      value: '',
      label: t('board.loose'),
      short: '',
      count: tasks.filter((x) => !x.milestone).length,
    },
  ]);
  const stOptions = $derived(
    STATUS_ORDER.map((s) => ({
      value: s,
      label: t(STATUS_META[s].label),
      count: tasks.filter((x) => boardStatus(x.status) === s).length,
    })),
  );
  const agOptions = $derived(
    (['claude-code', 'codex', 'none'] as const).map((a) => ({
      value: a as string,
      label: a === 'none' ? t('board.f.none') : a === 'codex' ? 'Codex' : 'Claude Code',
      count: tasks.filter((x) => (x.agent ?? 'none') === a).length,
    })),
  );
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
    options={msOptions}
    bind:selected={filters.milestones}
    width={226}
  >
    {#snippet marker(id: string)}<span data-task-toolbar class="ms-id">{id}</span>{/snippet}
  </FilterDrop>
  <FilterDrop
    label={t('board.f.status')}
    options={stOptions}
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
    options={agOptions}
    bind:selected={filters.agents}
    width={206}
  >
    {#snippet marker(a: string)}
      <span data-task-toolbar class="logo">
        {#if a === 'claude-code' || a === 'codex'}
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
  <div data-task-toolbar class="seg">
    <button
      data-task-toolbar
      type="button"
      class:active={view === 'board'}
      onclick={() => (view = 'board')}
    >
      <Icon name="board" size={13} stroke={2} />{t('board.view.board')}
    </button>
    <button
      data-task-toolbar
      type="button"
      class:active={view === 'list'}
      onclick={() => (view = 'list')}
    >
      <Icon name="list" size={13} stroke={2} />{t('board.view.list')}
    </button>
  </div>
</div>
