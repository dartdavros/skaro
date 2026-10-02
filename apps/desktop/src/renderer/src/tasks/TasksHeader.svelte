<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import Toolbar from './Toolbar.svelte';
  import type { TasksController } from './tasks-controller.svelte';
  let { state }: { state: TasksController } = $props();
</script>

<div data-task-tasks-screen class="top">
  <div data-task-tasks-screen class="titles">
    <div data-task-tasks-screen>
      <h1 data-task-tasks-screen>{t('tasks.title')}</h1>
      <div data-task-tasks-screen class="sub">{state.subtitle}</div>
    </div>
    <button data-task-tasks-screen type="button" class="new" onclick={state.p.onnew}
      ><Icon name="plus" size={14} stroke={2.6} />{t('board.new')}</button
    >
  </div>
  <Toolbar
    tasks={state.all}
    milestones={state.p.data.milestones}
    bind:filters={state.filters}
    bind:view={() => state.view, state.setView}
  />
</div>
