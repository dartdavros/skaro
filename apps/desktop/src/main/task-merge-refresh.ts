import type { TaskRuntime } from '@skaro/core';
import type { TimelineEvent } from '@skaro/timeline';
import type { ActiveRun } from './tasks';
import type { ProjectContext } from './projects';
import { mergeInteraction } from './task-merge-card';
import { closeMergeCards } from './task-merge-result';

export interface TaskMergeHooks {
  active: () => ActiveRun[];
  project: (id: string) => ProjectContext;
  skaroEvent: (active: ActiveRun, event: TimelineEvent) => void;
  settleRuntime: (active: ActiveRun) => void;
  changed: (projectId: string, taskId: string) => void;
  launchUnblocked: (projectId: string, ids: string[]) => Promise<void>;
  detach: (active: ActiveRun) => Promise<void>;
  setRuntime: (projectId: string, taskId: string, state: TaskRuntime) => void;
}

/** Only open merge cards are polled. Git and local file edits require no agent turn. */
export class MergeCardRefresh {
  private timer: NodeJS.Timeout | undefined;
  private refreshing = false;
  private closed = false;
  readonly busy = new Set<string>();

  private readonly hooks: TaskMergeHooks;
  constructor(hooks: TaskMergeHooks) {
    this.hooks = hooks;
  }

  watch(active: ActiveRun): void {
    if (
      this.closed ||
      this.timer ||
      !active.timeline.state.interactions.some((i) => i.kind === 'merge')
    )
      return;
    this.timer = setInterval(() => {
      void this.refresh();
    }, 1500);
    this.timer.unref();
  }

  async refresh(): Promise<void> {
    if (this.refreshing || this.closed) return;
    this.refreshing = true;
    try {
      const active = this.hooks
        .active()
        .filter((a) => a.timeline.state.interactions.some((i) => i.kind === 'merge'));
      if (!active.length) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
      for (const run of active) {
        if (this.busy.has(run.projectId)) continue;
        const card = run.timeline.state.interactions.find((i) => i.kind === 'merge');
        if (!card || card.kind !== 'merge' || !run.run.branch) continue;
        const context = this.hooks.project(run.projectId);
        try {
          const artifacts = await context.load();
          if (artifacts.tasks.find((task) => task.id === run.taskId)?.status === 'done') {
            closeMergeCards(run, this.hooks);
            continue;
          }
          const base = artifacts.config.baseBranch;
          const check = await context.git.checkMerge(base, run.run.branch);
          const next = mergeInteraction(card.id, run.run.branch, base, check);
          if (card.message) next.message = card.message;
          if (
            !this.closed &&
            !this.busy.has(run.projectId) &&
            run.timeline.state.interactions.includes(card) &&
            JSON.stringify(next) !== JSON.stringify(card)
          )
            this.hooks.skaroEvent(run, { t: 'interaction.opened', interaction: next });
        } catch {
          // A transient external Git operation is retried; confirmation always checks again.
        }
      }
    } finally {
      this.refreshing = false;
    }
  }

  close(): void {
    this.closed = true;
    clearInterval(this.timer);
  }
}
