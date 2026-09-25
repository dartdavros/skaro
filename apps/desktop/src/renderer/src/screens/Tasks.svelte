<script lang="ts">
  import { t } from '@skaro/ui';
  import type { TaskSummary } from '../../../shared/ipc';
  import StatusChip from '../task/StatusChip.svelte';

  /** Minimal task list until the "Задачи" screen (stage 7): open a task to work with its agent. */
  let { projectId, onopen }: { projectId: string; onopen: (taskId: string) => void } = $props();

  let tasks = $state<TaskSummary[] | undefined>();

  $effect(() => {
    const id = projectId;
    const load = () =>
      void window.skaro
        .invoke('tasks.list', id)
        .then((list) => (tasks = list))
        .catch(() => (tasks = []));
    load();
    return window.skaro.on('project.changed', (p) => p.projectId === id && load());
  });

  const visible = $derived((tasks ?? []).filter((task) => !task.archived));
</script>

<div class="tasks">
  <div class="titles">
    <h1 class="sk-title">{t('tasks.title')}</h1>
    <span class="sk-secondary">{t('tasks.subtitle')}</span>
  </div>
  {#if tasks && !visible.length}
    <div class="empty sk-text">{t('tasks.empty')}</div>
  {:else}
    <div class="list">
      {#each visible as task (task.id)}
        <button type="button" class="row" onclick={() => onopen(task.id)}>
          <span class="id">{task.id}</span>
          <span class="name">{task.title}</span>
          {#if task.milestone}<span class="milestone"
              >{task.milestone.id} · {task.milestone.title}</span
            >{/if}
          <StatusChip status={task.status} />
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .tasks {
    display: flex;
    flex-direction: column;
    gap: 22px;
    max-width: 880px;
  }

  .titles {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .empty {
    padding: 18px;
    border-radius: var(--sk-radius-card);
    background: var(--sk-surface);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border: none;
    border-radius: var(--sk-radius-card);
    background: var(--sk-surface);
    text-align: left;
    cursor: pointer;
    font: inherit;
  }

  .row:hover {
    background: var(--sk-surface-hover);
  }

  .id {
    flex: none;
    font-family: var(--sk-mono);
    font-size: 12px;
    color: #a6a6a6;
  }

  .name {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--sk-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .milestone {
    flex: none;
    font-size: 12px;
    color: var(--sk-text-muted);
  }
</style>
