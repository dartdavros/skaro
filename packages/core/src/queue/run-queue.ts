// Owner queue: independent tasks start immediately; only explicit ownership/readiness conflicts wait.

export interface RunQueueOptions {
  /** Why a task cannot run now (blocked, archived...), or undefined if it can. Checked on enqueue and on start. */
  canRun: (taskId: string) => string | undefined;
  /**
   * The task cannot start right now and keeps its place: another task of its stage works in
   * the checkout they share. `poke` rechecks the explicit ownership/readiness condition.
   */
  blocked?: (taskId: string) => boolean;
  /** Starts the run; resolves when the run ends (done, failed or interrupted). */
  start: (taskId: string) => Promise<void>;
}

export type QueueEvent =
  | { type: 'queued'; taskId: string; position: number }
  | { type: 'started'; taskId: string }
  | { type: 'finished'; taskId: string; error?: unknown }
  | { type: 'dropped'; taskId: string; reason: string }
  | { type: 'cancelled'; taskId: string };

export interface EnqueueResult {
  accepted: string[];
  /** Task id → reason it was not queued. */
  rejected: Record<string, string>;
}

export class RunQueue {
  private readonly running = new Set<string>();
  private readonly waiting: string[] = [];
  private readonly listeners = new Set<(event: QueueEvent) => void>();
  private readonly options: RunQueueOptions;
  private idleWaiters: (() => void)[] = [];

  constructor(options: RunQueueOptions) {
    this.options = options;
  }

  /** Queues tasks in order; every currently runnable owner starts immediately. */
  enqueue(taskIds: string[]): EnqueueResult {
    const result: EnqueueResult = { accepted: [], rejected: {} };
    for (const id of taskIds) {
      if (this.running.has(id) || this.waiting.includes(id)) {
        result.rejected[id] = 'already_queued';
        continue;
      }
      const reason = this.options.canRun(id);
      if (reason) {
        result.rejected[id] = reason;
        continue;
      }
      this.waiting.push(id);
      result.accepted.push(id);
      this.emit({ type: 'queued', taskId: id, position: this.waiting.length });
    }
    this.pump();
    return result;
  }

  /** Removes a task from the queue. Running tasks are stopped by their session, not here. */
  cancel(taskId: string): boolean {
    const index = this.waiting.indexOf(taskId);
    if (index < 0) return false;
    this.waiting.splice(index, 1);
    this.emit({ type: 'cancelled', taskId });
    return true;
  }

  state(): { running: string[]; queued: string[] } {
    return { running: [...this.running], queued: [...this.waiting] };
  }

  on(listener: (event: QueueEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** What held a waiting task back may be gone: start whatever can start now. */
  poke(): void {
    this.pump();
  }

  /** Resolves when nothing runs and nothing waits. */
  idle(): Promise<void> {
    if (!this.running.size && !this.waiting.length) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private pump(): void {
    for (;;) {
      const next = this.waiting.findIndex((id) => !this.options.blocked?.(id));
      if (next < 0) break;
      const id = this.waiting.splice(next, 1)[0]!;
      // The task may have changed while waiting (e.g. archived, or a dependency reopened).
      const reason = this.options.canRun(id);
      if (reason) {
        this.emit({ type: 'dropped', taskId: id, reason });
        continue;
      }
      this.running.add(id);
      this.emit({ type: 'started', taskId: id });
      let run: Promise<void>;
      try {
        run = this.options.start(id);
      } catch (error) {
        run = Promise.reject(error);
      }
      run.then(
        () => this.finish(id),
        (error: unknown) => this.finish(id, error),
      );
    }
    if (!this.running.size && !this.waiting.length) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  private finish(taskId: string, error?: unknown): void {
    this.running.delete(taskId);
    this.emit(
      error === undefined ? { type: 'finished', taskId } : { type: 'finished', taskId, error },
    );
    this.pump();
  }

  private emit(event: QueueEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
