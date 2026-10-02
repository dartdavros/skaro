import { RunQueue, type TaskRuntime } from '@skaro/core';
import type { MessageInput } from '../shared/ipc';
import type { ProjectContext } from './projects';
import type { NotifyKind } from './notifier';
import { TaskMerges } from './task-merges';
import { key } from './task-run-helpers';
import { ActiveRun, type TaskRunDeps } from './task-run-model';
import { TaskRunViews } from './task-run-views';
import { TaskRunScheduling } from './task-run-scheduling';
import { TaskRunMessages } from './task-run-messages';
import { TaskRunResults } from './task-run-results';
import { TaskRunMergeActions } from './task-run-merge-actions';
import { TaskRunSessions } from './task-run-sessions';
import { TaskRunEvents } from './task-run-events';
import { TaskRunHistory } from './task-run-history';

/** Shared state and composition of the task-run services. */
export class TaskRunEngine {
  readonly deps: TaskRunDeps;
  readonly active = new Map<string, ActiveRun>();
  readonly firstInputs = new Map<string, MessageInput>();
  readonly queue: RunQueue;
  readonly merges: TaskMerges;
  readonly views = new TaskRunViews(this);
  readonly scheduling = new TaskRunScheduling(this);
  readonly messages = new TaskRunMessages(this);
  readonly results = new TaskRunResults(this);
  readonly mergeActions = new TaskRunMergeActions(this);
  readonly sessions = new TaskRunSessions(this);
  readonly events = new TaskRunEvents(this);
  readonly history = new TaskRunHistory(this);
  constructor(deps: TaskRunDeps, slots = 3) {
    this.deps = deps;
    this.merges = new TaskMerges({
      deps,
      active: () => [...this.active.values()],
      project: (id) => this.project(id),
      skaroEvent: (active, event) => this.history.skaroEvent(active, event),
      settleRuntime: (active) => this.events.settleRuntime(active),
      changed: (projectId, taskId) => this.changed(projectId, taskId),
      launchUnblocked: (projectId, ids) => this.scheduling.launchUnblocked(projectId, ids),
      detach: (active) => this.sessions.detach(active),
      setRuntime: (projectId, taskId, state) => this.setRuntime(projectId, taskId, state),
    });
    this.queue = new RunQueue({
      slots,
      canRun: () => undefined,
      start: (key) => this.scheduling.begin(key),
    });
    this.queue.on((event) => {
      const [projectId, taskId] = event.taskId.split('\n') as [string, string];
      if (event.type === 'queued') this.setRuntime(projectId, taskId, 'queued');
      if (event.type === 'finished' && event.error) {
        this.setRuntime(projectId, taskId, 'idle');
      }
    });
  }

  setRuntime(projectId: string, taskId: string, state: TaskRuntime, runId?: string): void {
    const current = this.deps.db.getTaskRuntime(projectId).get(taskId);
    if (current?.state === state && current.runId === runId) return;
    this.deps.db.setTaskRuntime(projectId, taskId, state, runId);
    this.changed(projectId, taskId);
    this.deps.emit('project.changed', { projectId });
  }

  async notifyTask(kind: NotifyKind, projectId: string, taskId: string): Promise<void> {
    if (!this.deps.notify) return;
    const task = await this.project(projectId)
      .store.readTask(taskId)
      .catch(() => undefined);
    this.deps.notify(kind, task ? `${task.id} · ${task.title}` : taskId);
  }

  changed(projectId: string, taskId: string): void {
    this.deps.emit('task.changed', { projectId, taskId });
  }

  project(projectId: string): ProjectContext {
    return this.deps.projects.get(projectId);
  }

  requireActive(projectId: string, taskId: string): ActiveRun {
    const active = this.active.get(key(projectId, taskId));
    if (!active) throw new Error('The task has no run');
    return active;
  }
}
