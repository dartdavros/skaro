<script lang="ts">
  import { t } from '@skaro/ui';
  import type { MilestoneInfo, TaskSummary } from '../../../shared/ipc';
  import { groups } from './model';
  import TaskListRow from './TaskListRow.svelte';

  /** "Список": tasks grouped by milestone, one row per task (Tasks mockup). */
  let {
    tasks,
    milestones,
    selected,
    now,
    onselect,
    onopen,
  }: {
    tasks: TaskSummary[];
    milestones: MilestoneInfo[];
    selected: string[];
    now: number;
    onselect: (id: string, on: boolean) => void;
    onopen: (id: string) => void;
  } = $props();

  const list = $derived(groups(tasks, milestones, t('board.loose')));

  import './list.css';
</script>

<div data-task-list class="list">
  <div data-task-list class="grid head">
    <div data-task-list></div>
    <div data-task-list>{t('board.col.id')}</div>
    <div data-task-list>{t('board.col.title')}</div>
    <div data-task-list>{t('board.col.status')}</div>
    <div data-task-list>{t('board.col.agent')}</div>
    <div data-task-list>{t('board.col.deps')}</div>
    <div data-task-list class="right">{t('board.col.updated')}</div>
  </div>
  {#each list as group (group.id)}
    <div data-task-list class="group">
      <div data-task-list class="group-head">
        {#if group.id}<span data-task-list class="ms-id">{group.id}</span>{/if}
        <span data-task-list class="ms-name">{group.title}</span>
        <span data-task-list class="ms-count"
          >{t('projects.ofTotal', { done: group.done, total: group.total })}</span
        >
        <div data-task-list class="line"></div>
      </div>
      <div data-task-list class="rows">
        {#each group.tasks as task (task.id)}
          <TaskListRow {task} on={selected.includes(task.id)} {now} {onselect} {onopen} />
        {/each}
      </div>
    </div>
  {/each}
</div>
