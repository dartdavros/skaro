<script lang="ts">
  import { t } from '@skaro/ui';
  import type { TaskDetail } from '../../../shared/ipc';
  import TaskPanelIcon from './TaskPanelIcon.svelte';
  let { task, oncollapse }: { task: TaskDetail; oncollapse: () => void } = $props();
</script>

<div class="head">
  <span class="id">{task.id}</span>
  <button
    type="button"
    class="collapse"
    data-tip={t('task.collapse')}
    aria-label={t('task.collapse')}
    onclick={oncollapse}
  >
    <TaskPanelIcon />
  </button>
</div>
{#if task.milestone}
  <div class="stage">{task.milestone.id} · {task.milestone.title}</div>
{/if}
<h1>{task.title}</h1>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: var(--sk-fs-4);
    color: var(--sk-text-21);
    min-width: 0;
  }

  .stage {
    min-width: 0;
    font-size: var(--sk-fs-4);
    color: var(--sk-text-21);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .id {
    flex: 1;
    font-family: var(--sk-mono);
    color: var(--sk-text-13);
  }

  h1 {
    margin: 0;
    font-size: var(--sk-fs-12);
    font-weight: 700;
    line-height: 1.35;
    color: var(--sk-text-5);
    text-wrap: pretty;
  }

  .collapse {
    flex: none;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--sk-text-23);
    cursor: pointer;
    padding: 0;
  }

  .collapse:hover {
    background: var(--sk-fill-13);
    color: var(--sk-text-6);
  }
</style>
