import type { TaskRunEngine } from './task-run-engine';
import { cleanCompletedWorktrees } from './task-worktree-retention';

/** A real hourly sweep, plus startup/completion triggers; overlapping passes coalesce. */
export class TaskResourceCleanup {
  private pending?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private closed = false;
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }
  run(): Promise<void> {
    if (this.closed || this.ctx.closing) return Promise.resolve();
    this.timer ??= setInterval(() => void this.run(), 60 * 60_000);
    this.timer.unref();
    return (this.pending ??= this.sweep()
      .catch((error: unknown) => {
        console.error('Task resource cleanup:', error);
      })
      .finally(() => {
        this.pending = undefined;
      }));
  }
  private async sweep() {
    await this.ctx.environments.enforce();
    if (!this.closed && !this.ctx.closing) await cleanCompletedWorktrees(this.ctx);
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await this.pending;
  }
}
