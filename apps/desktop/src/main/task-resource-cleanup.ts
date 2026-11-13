import type { TaskRunEngine } from './task-run-engine';
import { cleanCompletedWorktrees } from './task-worktree-retention';
import { cleanCompletedIntegrations } from './integration-cleanup';
import { managedCachesFor } from './managed-caches';

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
    for (const [phase, action] of [
      ['environments', () => this.ctx.environments.enforce()],
      ['integrations', () => cleanCompletedIntegrations(this.ctx)],
      ['worktrees', () => cleanCompletedWorktrees(this.ctx)],
      ['history-cache', () => this.ctx.files.sweep()],
      ['managed-caches', () => managedCachesFor(this.ctx.deps.db)?.sweep() ?? Promise.resolve()],
    ] as const) {
      if (this.closed || this.ctx.closing) return;
      try {
        await action();
      } catch (error) {
        for (const project of this.ctx.deps.db.listProjects()) {
          if (
            this.ctx.deps.db.shell.projectScope &&
            this.ctx.deps.db.shell.projectScope !== project.id
          )
            continue;
          this.ctx.deps.db.addEvent(project.id, 'resource_cleanup_failed', { phase });
        }
        console.error(`Resource cleanup ${phase}:`, error);
      }
    }
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await this.pending;
  }
}
