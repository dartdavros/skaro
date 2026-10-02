<script lang="ts">
  import AssignDialog from './AssignDialog.svelte';
  import Board from './Board.svelte';
  import BulkDialog from './BulkDialog.svelte';
  import List from './List.svelte';
  import RunDialog from './RunDialog.svelte';
  import SelectionBar from './SelectionBar.svelte';
  import TasksHeader from './TasksHeader.svelte';
  import TasksEmpty from './TasksEmpty.svelte';
  import './i18n';
  import type { TasksProps } from './tasks-props';
  import { createTasksController } from './tasks-controller.svelte';
  let { projectId, data, onopen, onnew }: TasksProps = $props();
  const state = createTasksController({
    get projectId() {
      return projectId;
    },
    get data() {
      return data;
    },
    get onopen() {
      return onopen;
    },
    get onnew() {
      return onnew;
    },
  });

  import './tasks-screen.css';
</script>

<div data-task-tasks-screen class="screen">
  <TasksHeader {state} />

  {#if data.loaded && state.all.length === 0}
    <TasksEmpty {onnew} />
  {:else if state.view === 'board'}
    <Board
      tasks={state.shown}
      selected={state.selected}
      now={state.now}
      onselect={state.select}
      {onopen}
    />
  {:else}
    <List
      tasks={state.shown}
      milestones={data.milestones}
      selected={state.selected}
      now={state.now}
      onselect={state.select}
      {onopen}
    />
  {/if}

  {#if state.picked.length}
    <SelectionBar
      selected={state.picked}
      onaction={(a) => (state.dialog = a)}
      onclear={() => (state.selected = [])}
    />
  {/if}
</div>

{#if state.dialog === 'run'}
  <RunDialog
    {projectId}
    tasks={state.picked}
    onconfirm={state.run}
    onclose={() => (state.dialog = undefined)}
  />
{:else if state.dialog === 'assign'}
  <AssignDialog
    {projectId}
    count={state.picked.length}
    onconfirm={state.assign}
    onclose={() => (state.dialog = undefined)}
  />
{:else if state.dialog}
  <BulkDialog
    kind={state.dialog}
    tasks={state.picked}
    milestones={data.milestones}
    onconfirm={state.bulk}
    onclose={() => (state.dialog = undefined)}
  />
{/if}
