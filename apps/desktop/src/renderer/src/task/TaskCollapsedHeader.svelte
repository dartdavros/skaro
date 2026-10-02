<script lang="ts">
  import { t } from '@skaro/ui';
  import type { TaskDetail } from '../../../shared/ipc';
  import TaskPanelIcon from './TaskPanelIcon.svelte';
  let { task, onexpand, ontasks }: { task: TaskDetail; onexpand: () => void; ontasks: () => void } =
    $props();
</script>

<div class="head">
  <div class="crumbs">
    <button type="button" class="crumb" data-tip={t('task.crumbs.tasks.tip')} onclick={ontasks}
      >{t('task.crumbs.tasks')}</button
    >
    <span class="slash">/</span>
    <span class="id">{task.id}</span>
    <span class="slash">·</span>
    <span class="name">{task.title}</span>
  </div>
  <button
    type="button"
    class="expand"
    data-tip={t('task.expand')}
    aria-label={t('task.expand')}
    onclick={onexpand}
  >
    <TaskPanelIcon expand />
  </button>
</div>

<style>
  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 10px 14px 0;
  }

  .expand {
    flex: none;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 6px;
    background: var(--sk-fill-13);
    color: var(--sk-text-10);
    cursor: pointer;
    padding: 0;
  }

  .expand:hover {
    color: var(--sk-text-2);
  }

  .crumbs {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: var(--sk-fs-4);
    color: var(--sk-text-21);
    min-width: 0;
    flex: 1;
  }

  .crumb {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  .crumb:hover {
    color: var(--sk-text-6);
  }

  .slash {
    color: var(--sk-text-28);
  }

  .id {
    font-family: var(--sk-mono);
    color: var(--sk-text-13);
  }

  .name {
    color: var(--sk-text-13);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
