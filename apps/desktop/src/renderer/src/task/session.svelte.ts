// State of an open task screen: the view from the main process, then live timeline batches.

import { questionMessageReferences, type TimelineState } from '@skaro/timeline';
import type { TaskView } from '../../../shared/ipc';
import { TaskFeedState } from './feed-state';
import { TaskControls } from './task-controls.svelte';
import { readSession, saveSession } from '../session-snapshot';
import { currentHistory } from '../history-view';

export class TaskSession {
  readonly projectId: string;
  readonly taskId: string;
  readonly controls: TaskControls;
  view = $state.raw<TaskView | undefined>();
  timeline = $state.raw<TimelineState | undefined>();
  error = $state<string | undefined>();
  private readonly feed = new TaskFeedState();
  private readonly unsubscribe: (() => void)[] = [];
  private reloading: Promise<void> | undefined;
  private reloadAgain = false;
  private snapshotTimer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  questionReferences(timeline: TimelineState | undefined) {
    const sources = this.view?.timelineSources;
    return questionMessageReferences(
      timeline,
      sources && [
        ...(sources.base ? [sources.base] : []),
        ...sources.integrations.map((s) => s.timeline),
      ],
    );
  }

  rememberPage(page: import('../../../shared/history').HistoryPage): void {
    if (!this.view) return;
    this.view = { ...this.view, historyPage: page };
    this.remember();
  }

  constructor(projectId: string, taskId: string) {
    this.projectId = projectId;
    this.taskId = taskId;
    this.controls = new TaskControls(projectId, taskId);
    this.view = readSession<TaskView>(`task.${projectId}.${taskId}`);
    this.timeline = this.view?.timeline;
    const mine = (p: { projectId: string; taskId: string }) =>
      p.projectId === projectId && p.taskId === taskId;
    this.unsubscribe.push(
      window.skaro.on('task.events', (batch) => {
        if (!mine(batch)) return;
        if (this.view?.history) return;
        if (!this.feed.task(batch)) {
          // A new run or a gap: the snapshot is the truth.
          void this.reload();
          return;
        }
        this.timeline = this.feed.state;
        this.remember();
      }),
      window.skaro.on('integration.events', (batch) => {
        if (!mine(batch)) return;
        if (this.view?.history) return;
        if (!this.feed.integration(batch)) void this.reload();
        else this.timeline = this.feed.state;
      }),
      window.skaro.on('history.changed', (change) => {
        if (change.owner !== `${projectId}:task:${taskId}`) return;
        if (!change.view) {
          void this.reload();
          return;
        }
        if (!this.view?.history || change.view.source.revision < this.view.history.revision) return;
        this.view = {
          ...this.view,
          history: change.view.source,
          historyPage: change.view.page,
          timeline: change.view.timeline,
        };
        this.generation++;
        this.timeline = change.view.timeline;
        this.remember();
      }),
      window.skaro.on('task.changed', (p) => mine(p) && void this.reload()),
      window.skaro.on('project.changed', (p) => p.projectId === projectId && void this.reload()),
    );
  }

  /** Loads (or reloads) the view; overlapping calls collapse into one more round. */
  reload(): Promise<void> {
    this.controls.refresh();
    if (this.reloading) {
      this.reloadAgain = true;
      return this.reloading;
    }
    this.reloading = (async () => {
      do {
        this.reloadAgain = false;
        try {
          const generation = this.generation;
          let view = await window.skaro.invoke('task.open', this.projectId, this.taskId, {
            paged: true,
          });
          if (generation !== this.generation) view = currentHistory(view, this.view);
          this.view = view;
          this.error = view.error;
          if (view.history) this.timeline = view.timeline;
          else {
            this.feed.restore(view);
            this.timeline = this.feed.state;
          }
          this.remember();
        } catch (error) {
          this.error = error instanceof Error ? error.message : String(error);
        }
      } while (this.reloadAgain);
    })().finally(() => (this.reloading = undefined));
    return this.reloading;
  }

  async park(status: 'paused' | 'stopped'): Promise<void> {
    const reached = await window.skaro.invoke(
      'task.park',
      this.projectId,
      this.taskId,
      status,
      crypto.randomUUID(),
    );
    this.controls.confirmed(reached, this.view?.task);
    void this.reload();
  }

  dispose(): void {
    clearTimeout(this.snapshotTimer);
    this.save();
    for (const off of this.unsubscribe) off();
  }
  private save(): void {
    if (this.view) saveSession(`task.${this.projectId}.${this.taskId}`, this.view, this.timeline);
  }
  private remember(): void {
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => this.save(), 750);
  }
}
