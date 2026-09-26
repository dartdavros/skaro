<script lang="ts">
  import { Icon, t, tn } from '@skaro/ui';
  import type { TaskAssignment } from '../../../shared/ipc';
  import AssignDialog from './AssignDialog.svelte';
  import Board from './Board.svelte';
  import BulkDialog from './BulkDialog.svelte';
  import type { ProjectTasks } from './data.svelte';
  import './i18n';
  import List from './List.svelte';
  import { applyFilters, needsYou, type BulkAction, type Filters } from './model';
  import RunDialog from './RunDialog.svelte';
  import SelectionBar from './SelectionBar.svelte';
  import Toolbar from './Toolbar.svelte';

  /** "Задачи" (Tasks mockup): board or list, filters, selection and bulk actions. */
  let {
    projectId,
    data,
    onopen,
    onnew,
  }: {
    projectId: string;
    /** Tasks and milestones of the project, shared with the sections panel. */
    data: ProjectTasks;
    onopen: (taskId: string) => void;
    /** "Новая задача": tasks are created with the agent in a new chat. */
    onnew: () => void;
  } = $props();

  let view = $state<'board' | 'list'>('board');
  let filters = $state<Filters>({ query: '', milestones: [], statuses: [], agents: [] });
  let selected = $state<string[]>([]);
  let dialog = $state<BulkAction | undefined>();
  let now = $state(Date.now());

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    void window.skaro
      .invoke('app.getSetting', `tasks.${projectId}.view`)
      .then((v) => (view = v === 'list' ? 'list' : 'board'));
  });

  const all = $derived(data.tasks.filter((x) => !x.archived));
  const shown = $derived(applyFilters(all, filters));
  const picked = $derived(all.filter((x) => selected.includes(x.id)));
  const subtitle = $derived(
    [
      tn('board.count', all.length),
      tn('board.running', all.filter((x) => x.status === 'in_progress').length),
      tn('board.waiting', all.filter(needsYou).length),
    ].join(' · '),
  );

  // Tasks that left the board (deleted, archived) leave the selection too.
  $effect(() => {
    const ids = new Set(all.map((x) => x.id));
    if (selected.some((id) => !ids.has(id))) selected = selected.filter((id) => ids.has(id));
  });

  function setView(next: 'board' | 'list'): void {
    view = next;
    void window.skaro.invoke('app.setSetting', `tasks.${projectId}.view`, next);
  }

  function select(id: string, on: boolean): void {
    selected = on ? [...selected, id] : selected.filter((x) => x !== id);
  }

  async function act(run: () => Promise<unknown>): Promise<void> {
    dialog = undefined;
    await run().catch(() => undefined);
  }

  const ids = () => $state.snapshot(selected);

  function bulk(milestone?: string): Promise<void> {
    const kind = dialog;
    return act(async () => {
      if (kind === 'delete') await window.skaro.invoke('tasks.delete', projectId, ids());
      if (kind === 'archive') await window.skaro.invoke('tasks.archive', projectId, ids(), true);
      if (kind === 'unblock') await window.skaro.invoke('tasks.unblock', projectId, ids());
      if (kind === 'move' && milestone)
        await window.skaro.invoke('tasks.move', projectId, ids(), milestone);
      if (kind === 'delete' || kind === 'archive') selected = [];
    });
  }

  function run(assignment?: TaskAssignment): Promise<void> {
    return act(async () => {
      await window.skaro.invoke(
        'tasks.run',
        projectId,
        ids(),
        t('task.start.message'),
        ...(assignment ? [assignment] : []),
      );
      selected = [];
    });
  }

  function assign(assignment: TaskAssignment): Promise<void> {
    return act(() => window.skaro.invoke('tasks.assign', projectId, ids(), assignment));
  }
</script>

<div class="screen">
  <div class="top">
    <div class="titles">
      <div>
        <h1>{t('tasks.title')}</h1>
        <div class="sub">{subtitle}</div>
      </div>
      <button type="button" class="new" onclick={onnew}
        ><Icon name="plus" size={14} stroke={2.6} />{t('board.new')}</button
      >
    </div>
    <Toolbar
      tasks={all}
      milestones={data.milestones}
      bind:filters
      bind:view={() => view, setView}
    />
  </div>

  {#if data.loaded && all.length === 0}
    <div class="empty">
      <div class="empty-icon">
        <Icon name="box" size={24} stroke={1.7} color="var(--sk-text-22)" />
      </div>
      <div class="empty-copy">
        <div class="empty-title">{t('board.empty.title')}</div>
        <div class="empty-text">{t('board.empty.text')}</div>
      </div>
      <button type="button" class="new big" onclick={onnew}
        ><Icon name="plus" size={14} stroke={2.6} />{t('board.new')}</button
      >
    </div>
  {:else if view === 'board'}
    <Board tasks={shown} {selected} {now} onselect={select} {onopen} />
  {:else}
    <List tasks={shown} milestones={data.milestones} {selected} {now} onselect={select} {onopen} />
  {/if}

  {#if picked.length}
    <SelectionBar
      selected={picked}
      onaction={(a) => (dialog = a)}
      onclear={() => (selected = [])}
    />
  {/if}
</div>

{#if dialog === 'run'}
  <RunDialog {projectId} tasks={picked} onconfirm={run} onclose={() => (dialog = undefined)} />
{:else if dialog === 'assign'}
  <AssignDialog
    {projectId}
    count={picked.length}
    onconfirm={assign}
    onclose={() => (dialog = undefined)}
  />
{:else if dialog}
  <BulkDialog
    kind={dialog}
    tasks={picked}
    milestones={data.milestones}
    onconfirm={bulk}
    onclose={() => (dialog = undefined)}
  />
{/if}

<style>
  .screen {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--sk-fill-5);
  }

  .top {
    flex: none;
    padding: 20px 24px 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .titles {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
  }

  h1 {
    margin: 0;
    font-size: var(--sk-fs-15);
    font-weight: 700;
    color: var(--sk-text-5);
    letter-spacing: -0.01em;
  }

  .sub {
    margin-top: 5px;
    font-size: var(--sk-fs-6);
    color: var(--sk-text-17);
  }

  .new {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 14px;
    border: none;
    border-radius: 8px;
    background: var(--sk-accent);
    color: var(--sk-text-1);
    font-size: var(--sk-fs-5);
    font-weight: 700;
    cursor: pointer;
  }

  .new:hover {
    background: var(--sk-accent-hover);
  }

  .new.big {
    gap: 8px;
    height: 34px;
    padding: 0 16px;
    font-size: var(--sk-fs-6);
  }

  .empty {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    padding: 0 24px 40px;
    text-align: center;
  }

  .empty-icon {
    width: 54px;
    height: 54px;
    border-radius: 14px;
    background: var(--sk-fill-12);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .empty-copy {
    max-width: 420px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .empty-title {
    font-size: var(--sk-fs-13);
    font-weight: 700;
    color: var(--sk-text-2);
  }

  .empty-text {
    font-size: var(--sk-fs-7);
    line-height: 1.6;
    color: var(--sk-text-17);
    text-wrap: pretty;
  }
</style>
