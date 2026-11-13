import type { TaskKey } from '@skaro/core';
import type { TaskView } from '../shared/ipc';
import type { HeldResource } from './resource-execution';

function completion() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export interface SavedEnvironmentReview extends TaskKey {
  id: string;
  environment: TaskKey;
}

/** A review's lifetime is independent of the agent's turns and of the renderer screen. */
export class EnvironmentReview implements SavedEnvironmentReview {
  readonly id: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly environment: TaskKey;
  state: NonNullable<TaskView['environmentReview']> = 'queued';
  cancelled = false;
  cleanupFailed = false;
  holding?: HeldResource;
  readonly controller = new AbortController();
  readonly ready = completion();
  readonly ended = completion();
  readonly stopped = completion();
  readonly released = completion();

  constructor(record: SavedEnvironmentReview) {
    this.id = record.id;
    this.projectId = record.projectId;
    this.taskId = record.taskId;
    this.environment = record.environment;
    // A failed cleanup remains available for a later Finish retry.
    void this.stopped.promise.catch(() => undefined);
  }
}
