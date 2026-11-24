import type { TaskDetail } from '../../../shared/ipc';
import type { TimelineState } from '@skaro/timeline';
import type { TaskParkReceipt } from '../../../shared/task-park';

export class TaskControls {
  task = $state.raw<TaskDetail | undefined>();
  private generation = 0;
  private loading?: Promise<void>;
  private again = false;
  private readonly projectId: string;
  private readonly taskId: string;
  constructor(projectId: string, taskId: string) {
    this.projectId = projectId;
    this.taskId = taskId;
  }

  refresh(): void {
    if (this.loading) {
      this.again = true;
      return;
    }
    const generation = this.generation;
    this.loading = window.skaro
      .invoke('task.controls', this.projectId, this.taskId)
      .then((task) => {
        if (
          generation === this.generation &&
          (task?.lifecycleRevision ?? 0) >= (this.task?.lifecycleRevision ?? 0)
        )
          this.task = task;
      })
      .catch((error: unknown) => console.error('Task control state:', error))
      .finally(() => {
        this.loading = undefined;
        if (this.again) {
          this.again = false;
          this.refresh();
        }
      });
  }

  timeline(state: TimelineState | undefined) {
    const status = this.task?.status;
    return state && state.status !== 'idle' && (status === 'paused' || status === 'stopped')
      ? { ...state, status: 'idle' as const, activity: undefined }
      : state;
  }

  confirmed(receipt: TaskParkReceipt, fallback?: TaskDetail): void {
    if ((this.task?.lifecycleRevision ?? 0) > receipt.revision) return;
    const { status } = receipt;
    this.generation++;
    const task = this.task ?? fallback;
    if (task)
      this.task = {
        ...task,
        status,
        stage: status,
        lifecyclePending: false,
        lifecycleRevision: receipt.revision,
        resourceWait: undefined,
      };
    this.refresh();
  }
}
