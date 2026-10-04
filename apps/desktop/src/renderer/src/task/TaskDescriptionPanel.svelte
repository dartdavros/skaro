<script lang="ts">
  import { PanelResizer, t } from '@skaro/ui';
  import type { StageView, TaskDetail } from '../../../shared/ipc';
  import TaskDescription from './TaskDescription.svelte';
  import type { TaskDescriptionLayout } from './task-description-layout.svelte';
  let {
    task,
    stage,
    layout,
    onspec,
    onopen,
    ontoggle,
  }: {
    task: TaskDetail;
    /** The screen of a stage: the milestone with its tasks instead of a task. */
    stage?: StageView | undefined;
    layout: TaskDescriptionLayout;
    onspec: (path: string) => void;
    onopen: (taskId: string) => void;
    ontoggle: (index: number) => void;
  } = $props();
  const id = $props.id();
</script>

<PanelResizer
  width={layout.width}
  min={240}
  max={520}
  side="right"
  controls={id}
  label={t('task.resize')}
  onresize={(next) => layout.setWidth(next)}
  oncommit={() => layout.save()}
/>
<div {id} class="desc-col" style="width: {layout.width}px">
  <TaskDescription
    {task}
    {stage}
    oncollapse={() => layout.setOpen(false)}
    {onspec}
    {onopen}
    {ontoggle}
  />
</div>

<style>
  .desc-col {
    flex: none;
    min-height: 0;
    overflow-y: auto;
    background: var(--sk-fill-5);
  }
</style>
