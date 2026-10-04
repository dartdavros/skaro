<script lang="ts">
  import { t } from '@skaro/ui';
  import { taskDot } from './header-task-dot';
  import type { HeaderProps } from './header-props';
  let {
    tasks,
    ontask,
  }: { tasks: NonNullable<HeaderProps['tasks']>; ontask: HeaderProps['ontask'] } = $props();
  const done = $derived(tasks.filter((x) => x.status === 'done').length);
</script>

<div data-doc-header class="spec-tasks">
  <div data-doc-header class="spec-tasks-head">
    <span data-doc-header class="sk-label">{t('docs.spec.tasks')}</span>
    <span data-doc-header class="spec-tasks-done"
      >{t('docs.spec.tasks.done', { n: done, of: tasks.length })}</span
    >
  </div>
  <div data-doc-header class="spec-tasks-list">
    {#each tasks as task (task.id)}
      {@const dot = taskDot(task.status)}
      <button
        data-doc-header
        type="button"
        class="spec-task"
        data-tip={t('docs.spec.task.tip')}
        onclick={() => ontask(task.id)}
      >
        <span data-doc-header class="spec-task-id">{task.id}</span>
        <span data-doc-header class="spec-task-title" class:done={task.status === 'done'}
          >{task.title}</span
        >
        <span data-doc-header class="spec-task-status"
          ><span data-doc-header class="dot" class:pulse={dot.pulse} style="background: {dot.color}"
          ></span>{t(`task.status.${task.status}`)}</span
        >
      </button>
    {/each}
  </div>
</div>
