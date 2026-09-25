// State of an open task screen: the view from the main process, then live timeline batches.

import { Timeline, type TimelineState } from '@skaro/timeline';
import type { TaskView } from '../../../shared/ipc';

export class TaskSession {
  readonly projectId: string;
  readonly taskId: string;
  view = $state.raw<TaskView | undefined>();
  timeline = $state.raw<TimelineState | undefined>();
  error = $state<string | undefined>();
  private live: Timeline | undefined;
  private runId: string | undefined;
  private seq = 0;
  private readonly unsubscribe: (() => void)[] = [];
  private reloading: Promise<void> | undefined;
  private reloadAgain = false;

  constructor(projectId: string, taskId: string) {
    this.projectId = projectId;
    this.taskId = taskId;
    const mine = (p: { projectId: string; taskId: string }) =>
      p.projectId === projectId && p.taskId === taskId;
    this.unsubscribe.push(
      window.skaro.on('task.events', (batch) => {
        if (!mine(batch)) return;
        if (batch.runId !== this.runId || batch.seq > this.seq) {
          // A new run or a gap: the snapshot is the truth.
          void this.reload();
          return;
        }
        const fresh = batch.events.slice(this.seq - batch.seq);
        if (!fresh.length) return;
        this.live ??= new Timeline();
        for (const event of fresh) this.live.apply(event);
        this.seq += fresh.length;
        this.timeline = { ...this.live.state };
      }),
      window.skaro.on('task.changed', (p) => mine(p) && void this.reload()),
      window.skaro.on('project.changed', (p) => p.projectId === projectId && void this.reload()),
    );
  }

  /** Loads (or reloads) the view; overlapping calls collapse into one more round. */
  reload(): Promise<void> {
    if (this.reloading) {
      this.reloadAgain = true;
      return this.reloading;
    }
    this.reloading = (async () => {
      do {
        this.reloadAgain = false;
        try {
          const view = await window.skaro.invoke('task.open', this.projectId, this.taskId);
          this.view = view;
          this.error = undefined;
          if (view.run?.id !== this.runId || view.seq > this.seq || !this.live) {
            this.runId = view.run?.id;
            this.seq = view.seq;
            this.live = view.timeline
              ? Timeline.restore(structuredClone(view.timeline))
              : undefined;
            this.timeline = this.live ? { ...this.live.state } : undefined;
          }
        } catch (error) {
          this.error = error instanceof Error ? error.message : String(error);
        }
      } while (this.reloadAgain);
    })().finally(() => (this.reloading = undefined));
    return this.reloading;
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
  }
}
