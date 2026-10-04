<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { AgentInfo } from '../../../shared/ipc';
  import ImageViewer from '../feed/ImageViewer.svelte';
  import '../feed/i18n';
  import AgentModal from './AgentModal.svelte';
  import TaskConversation from './TaskConversation.svelte';
  import TaskDescriptionPanel from './TaskDescriptionPanel.svelte';
  import { createTaskController } from './task-controller.svelte';
  import { TaskDescriptionLayout } from './task-description-layout.svelte';
  let {
    projectId,
    taskId,
    agents,
    ontasks,
    onplan,
    onopen,
    onspec,
  }: {
    projectId: string;
    taskId: string;
    agents: AgentInfo[];
    ontasks: () => void;
    /** Back from the screen of a stage: it is opened from "План". */
    onplan: () => void;
    /** Opens another task, or the stage a task works in. */
    onopen: (id: string) => void;
    onspec: (path: string) => void;
  } = $props();
  // The screen is keyed by task.
  // svelte-ignore state_referenced_locally
  const controller = createTaskController(projectId, taskId, () => agents, onopen);
  const layout = new TaskDescriptionLayout();
  onDestroy(() => layout.dispose());
  const view = $derived(controller.view);
  const settings = $derived(controller.settings);
</script>

<div class="task">
  <TaskConversation
    {controller}
    {projectId}
    {taskId}
    descriptionOpen={layout.open}
    onexpand={() => layout.setOpen(true)}
    {ontasks}
    {onplan}
  />
  {#if view && layout.open}
    <TaskDescriptionPanel
      task={view.task}
      stage={view.stage}
      {layout}
      {onspec}
      {onopen}
      ontoggle={(i) => void window.skaro.invoke('task.toggleCriterion', projectId, taskId, i)}
    />
  {/if}
</div>
{#if view && settings}
  <AgentModal
    bind:open={controller.modal}
    {projectId}
    {settings}
    {agents}
    locked={view.run !== undefined}
    {...view.task.branch ? { branch: view.task.branch } : {}}
    {...view.sandboxHolds !== undefined ? { sandboxHolds: view.sandboxHolds } : {}}
    onsave={controller.saveSettings}
  />
{/if}
<ImageViewer bind:src={controller.viewer} />

<style>
  .task {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }
</style>
