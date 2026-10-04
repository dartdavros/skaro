<script lang="ts">
  import type { AgentInfo, ProjectInfo } from '../../../shared/ipc';
  import type { ProjectTasks } from '../tasks/data.svelte';
  import ChatScreen from '../chat/ChatScreen.svelte';
  import DocsScreen from '../docs/DocsScreen.svelte';
  import PlanScreen from '../plan/PlanScreen.svelte';
  import TaskScreen from '../task/TaskScreen.svelte';
  import TasksScreen from '../tasks/TasksScreen.svelte';
  import ProjectParams from '../params/ProjectParams.svelte';

  let {
    project,
    section,
    task,
    stage = false,
    chat = $bindable(),
    doc,
    data,
    agents,
    ontasks,
    openDoc,
    newChat,
    go,
    openTask,
    onremove,
    onchanged,
    onimport,
  }: {
    project: ProjectInfo;
    section: string;
    task?: string | undefined;
    /** The open task names a milestone: the screen of its stage, under "План". */
    stage?: boolean;
    chat?: string | undefined;
    doc?: string | undefined;
    data: ProjectTasks;
    agents: AgentInfo[];
    ontasks: () => void;
    openDoc: (path: string) => void;
    newChat: () => void;
    go: (id: string) => void;
    openTask: (id: string) => void;
    onremove: () => void;
    onchanged: () => void;
    onimport: () => void;
  } = $props();
</script>

{#if task && (stage ? section === 'plan' : section === 'tasks')}
  {#key task}
    <TaskScreen
      projectId={project.id}
      taskId={task}
      {agents}
      {ontasks}
      onplan={ontasks}
      onopen={openTask}
      onspec={openDoc}
    />
  {/key}
{:else if section === 'docs'}
  <DocsScreen
    projectId={project.id}
    open={doc}
    tasks={data}
    onchat={newChat}
    ontask={openTask}
    {onimport}
  />
{:else if section === 'plan'}
  <PlanScreen projectId={project.id} {data} onopen={openTask} onchat={newChat} />
{:else if section === 'params'}
  <ProjectParams {project} {onremove} {onchanged} />
{:else if section === 'chat'}
  {#key project.id}
    <ChatScreen {project} {agents} bind:chat onsection={go} {onimport} />
  {/key}
{:else}
  <TasksScreen projectId={project.id} {data} onopen={openTask} onnew={newChat} />
{/if}
