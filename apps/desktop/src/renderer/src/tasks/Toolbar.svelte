<script lang="ts">
  import { AgentLogo, Icon, t } from '@skaro/ui';
  import type { MilestoneInfo, TaskSummary } from '../../../shared/ipc';
  import FilterDrop from './FilterDrop.svelte';
  import { boardStatus, STATUS_META, STATUS_ORDER, type BoardStatus, type Filters } from './model';

  /** Search, the milestone / status / agent filters and the board-list switch (Tasks mockup). */
  let {
    tasks,
    milestones,
    filters = $bindable(),
    view = $bindable(),
  }: {
    tasks: TaskSummary[];
    milestones: MilestoneInfo[];
    filters: Filters;
    view: 'board' | 'list';
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
</script>

<div class="bar">
  <div class="search">
    <span class="glass"><Icon name="search" size={14} stroke={2} color="var(--sk-text-18)" /></span>
    <input type="text" placeholder={t('board.search')} bind:value={filters.query} />
  </div>

  <FilterDrop
    label={t('board.f.milestone')}
    options={msOptions}
    bind:selected={filters.milestones}
    width={226}
  >
    {#snippet marker(id: string)}<span class="ms-id">{id}</span>{/snippet}
  </FilterDrop>
  <FilterDrop
    label={t('board.f.status')}
    options={stOptions}
    bind:selected={filters.statuses}
    width={214}
  >
    {#snippet marker(s: BoardStatus)}<span class="dot" style="background: {STATUS_META[s].color}"
      ></span>{/snippet}
  </FilterDrop>
  <FilterDrop
    label={t('board.f.agent')}
    options={agOptions}
    bind:selected={filters.agents}
    width={206}
  >
    {#snippet marker(a: string)}
      <span class="logo">
        {#if a === 'claude-code' || a === 'codex'}
          <AgentLogo agent={a} size={12} />
        {:else}
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--sk-text-22)"
            stroke-width="2"><circle cx="12" cy="12" r="8" stroke-dasharray="3 3" /></svg
          >
        {/if}
      </span>
    {/snippet}
  </FilterDrop>

  {#if any}
    <button
      type="button"
      class="reset"
      onclick={() => (filters = { ...filters, milestones: [], statuses: [], agents: [] })}
      >{t('board.reset')}</button
    >
  {/if}

  <div class="spacer"></div>
  <div class="seg">
    <button type="button" class:active={view === 'board'} onclick={() => (view = 'board')}>
      <Icon name="board" size={13} stroke={2} />{t('board.view.board')}
    </button>
    <button type="button" class:active={view === 'list'} onclick={() => (view = 'list')}>
      <Icon name="list" size={13} stroke={2} />{t('board.view.list')}
    </button>
  </div>
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 9px;
  }

  .search {
    position: relative;
    flex: none;
    width: 210px;
  }

  .glass {
    position: absolute;
    left: 10px;
    top: 8px;
    display: inline-flex;
  }

  input {
    width: 100%;
    height: 31px;
    padding: 0 10px 0 31px;
    border: none;
    border-radius: 8px;
    background: var(--sk-fill-3);
    color: var(--sk-text-2);
    font-size: var(--sk-fs-5);
    outline: none;
    box-shadow: inset 0 0 0 1px var(--sk-fill-25);
  }

  input:hover {
    background: var(--sk-field-hover);
    box-shadow: inset 0 0 0 1px var(--sk-fill-31);
  }

  input:focus {
    background: var(--sk-field-hover);
    box-shadow: inset 0 0 0 1px var(--sk-accent);
  }

  .ms-id {
    flex: none;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-17);
  }

  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .logo {
    flex: none;
    width: 13px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--sk-text-6);
  }

  .reset {
    flex: none;
    height: 31px;
    padding: 0 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--sk-text-17);
    font-size: var(--sk-fs-5);
    font-weight: 600;
    cursor: pointer;
  }

  .reset:hover {
    background: var(--sk-fill-15);
    color: var(--sk-text-2);
  }

  .spacer {
    flex: 1;
  }

  .seg {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: var(--sk-deep);
  }

  .seg button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 27px;
    padding: 0 11px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--sk-text-17);
    font-size: var(--sk-fs-5);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }

  .seg button.active {
    background: var(--sk-fill-5);
    color: var(--sk-text-2);
    box-shadow: 0 1px 2px var(--sk-black-a35);
  }
</style>
