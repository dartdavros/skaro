<script lang="ts">
  import { Button, Icon, t } from '@skaro/ui';
  import type { TaskDetail } from '../../../shared/ipc';
  import StatusChip from './StatusChip.svelte';
  import { taskLifecycleActions, type TaskLifecycleAction } from './task-lifecycle-actions';

  let {
    task,
    onaction,
  }: {
    task: TaskDetail;
    onaction: (action: TaskLifecycleAction) => Promise<void>;
  } = $props();
  let pending = $state(false);
  const icons = { start: 'play', pause: 'pause', stop: 'stopSquare', resume: 'play' } as const;

  async function run(action: TaskLifecycleAction): Promise<void> {
    if (pending) return;
    pending = true;
    try {
      await onaction(action);
    } finally {
      pending = false;
    }
  }
</script>

<div class="status-row" aria-busy={pending}>
  <StatusChip status={task.status} resourceWait={task.resourceWait} />
  {#each taskLifecycleActions(task) as action (action)}
    <Button
      size="sm"
      disabled={pending || (action === 'start' && task.status === 'blocked')}
      onclick={() => void run(action).catch(() => undefined)}
    >
      <Icon name={icons[action]} size={13} stroke={2} />
      {t(`task.${action}`)}
    </Button>
  {/each}
</div>

<style>
  .status-row {
    display: flex;
    min-height: 28px;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
</style>
