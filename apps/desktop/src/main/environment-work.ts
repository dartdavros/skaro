import type { TaskKey } from '@skaro/core';

/** Serialize one environment; global maintenance drains every owner before touching resources. */
export class EnvironmentWork {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly starts = new Map<string, TaskKey>();
  private barrier: Promise<void> = Promise.resolve();

  starting(): TaskKey[] {
    return [...this.starts.values()];
  }

  run<T>(key: TaskKey, action: () => Promise<T>, starting = false): Promise<T> {
    const id = JSON.stringify([key.projectId, key.taskId]);
    const next = Promise.all([this.barrier, this.tails.get(id)]).then(async () => {
      if (starting) this.starts.set(id, key);
      try {
        return await action();
      } finally {
        if (starting) this.starts.delete(id);
      }
    });
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(id, tail);
    void tail.then(() => {
      if (this.tails.get(id) === tail) this.tails.delete(id);
    });
    return next;
  }

  exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = Promise.all([this.barrier, ...this.tails.values()]).then(action);
    this.barrier = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async idle(): Promise<void> {
    await Promise.all([this.barrier, ...this.tails.values()]);
  }
}
