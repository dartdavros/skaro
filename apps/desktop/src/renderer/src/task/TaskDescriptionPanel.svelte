<script lang="ts">
  import { PanelResizer, t } from '@skaro/ui';
  import type { TaskDetail } from '../../../shared/ipc';
  import TaskDescription from './TaskDescription.svelte';
  import type { TaskDescriptionLayout } from './task-description-layout.svelte';
  let {
    task,
    layout,
    onspec,
    ontoggle,
  }: {
    task: TaskDetail;
    layout: TaskDescriptionLayout;
    onspec: (path: string) => void;
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
  <TaskDescription {task} oncollapse={() => layout.setOpen(false)} {onspec} {ontoggle} />
</div>

<style>
  .desc-col {
    flex: none;
    min-height: 0;
    overflow-y: auto;
    background: var(--sk-fill-5);
  }
</style>
