<script lang="ts">
  import { t } from '@skaro/ui';
  import type { StageView } from '../../../shared/ipc';
  import { taskDot } from '../docs/header-task-dot';

  /**
   * «Задачи» of the stage screen ("Экран этапа" mockup): the block of the specification page in
   * the narrow panel. A finished task says "Сделана"; the full words are in its tip.
   */
  let { stage, onopen }: { stage: StageView; onopen: (taskId: string) => void } = $props();
</script>

<div class="tasks">
  <div class="head">
    <span class="sk-label">{t('task.stage.tasks')}</span>
    <span class="count"
      >{t('task.stage.tasks.done', { n: stage.info.finished, of: stage.info.total })}</span
    >
  </div>
  <div class="list">
    {#each stage.tasks as task (task.id)}
      {@const dot = taskDot(task.status)}
      <button type="button" class="row" onclick={() => onopen(task.id)}>
        <span class="id">{task.id}</span>
        <span class="title">{task.title}</span>
        {#if task.status === 'review'}
          <span class="status" data-tip={t('task.stage.task.finished.tip')}
            ><span class="dot ring"></span>{t('task.stage.task.finished')}</span
          >
        {:else}
          <span class="status"
            ><span class="dot" class:pulse={dot.pulse} style="background: {dot.color}"></span>{t(
              `task.status.${task.status}`,
            )}</span
          >
        {/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .tasks {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--sk-surface);
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .count {
    font-size: var(--sk-fs-4);
    color: var(--sk-text-19);
  }

  .list {
    display: flex;
    flex-direction: column;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 -8px;
    padding: 6px 8px;
    border: none;
    border-radius: 7px;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .row:hover {
    background: var(--sk-surface-hover);
  }

  .id {
    flex: none;
    width: 46px;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
    color: var(--sk-text-17);
  }

  .title {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-5);
    color: var(--sk-text-6);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--sk-fs-3);
    color: var(--sk-text-19);
  }

  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .dot.pulse {
    animation: skPulse 1.6s ease-in-out infinite;
  }

  .dot.ring {
    box-shadow: inset 0 0 0 1.5px var(--sk-link);
  }
</style>
