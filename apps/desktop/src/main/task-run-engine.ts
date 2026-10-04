import { RunQueue, type TaskKey, type TaskRuntime } from '@skaro/core';
import type { MessageInput } from '../shared/ipc';
import type { ProjectContext } from './projects';
import type { NotifyKind } from './notifier';
import { TaskEnvironments } from './task-environments';
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
import { TaskRunStages } from './task-run-stages';
import { checkoutKey, stageTasks } from './task-stage';
import { readSubject, subjectStage } from './task-subject';
import { stageNotice } from './stage-views';

function taskKey(k: string): TaskKey {
  const [projectId, taskId] = k.split('\n') as [string, string];
  return { projectId, taskId };
}

/** Shared state and composition of the task-run services. */
export class TaskRunEngine {
  readonly deps: TaskRunDeps;
  readonly active = new Map<string, ActiveRun>();
  /** Messages that wait for a queue slot, in the order they were sent. */
  readonly queuedInputs = new Map<string, MessageInput[]>();
  readonly queue: RunQueue;
  readonly merges: TaskMerges;
  readonly environments: TaskEnvironments;
  readonly views = new TaskRunViews(this);
  readonly scheduling = new TaskRunScheduling(this);
  readonly messages = new TaskRunMessages(this);
  readonly results = new TaskRunResults(this);
  readonly mergeActions = new TaskRunMergeActions(this);
  readonly sessions = new TaskRunSessions(this);
  readonly events = new TaskRunEvents(this);
  readonly history = new TaskRunHistory(this);
  readonly stages = new TaskRunStages(this);
  constructor(deps: TaskRunDeps, slots = 3) {
    this.deps = deps;
    this.merges = new TaskMerges({
      deps,
      active: () => [...this.active.values()],
      restore: (projectId, taskId) => this.history.restore(projectId, taskId),
      project: (id) => this.project(id),
      skaroEvent: (active, event) => this.history.skaroEvent(active, event),
      settleRuntime: (active) => this.events.settleRuntime(active),
      changed: (projectId, taskId) => this.changed(projectId, taskId),
      launchUnblocked: (projectId, ids) => this.scheduling.launchUnblocked(projectId, ids),
      detach: (active) => this.sessions.detach(active),
      setRuntime: (projectId, taskId, state) => this.setRuntime(projectId, taskId, state),
      removeEnvironment: (projectId, taskId) => this.removeEnvironment({ projectId, taskId }),
    });
    this.queue = new RunQueue({
      slots,
      canRun: () => undefined,
      blocked: (key) => this.stages.blocked(key),
      start: (key) => this.scheduling.begin(key),
    });
    this.queue.on((event) => {
      const { projectId, taskId } = taskKey(event.taskId);
      if (event.type === 'queued') this.setRuntime(projectId, taskId, 'queued');
      if (event.type === 'finished' && event.error) {
        this.setRuntime(projectId, taskId, 'idle');
      }
    });
    this.environments = new TaskEnvironments({
      db: deps.db,
      dataDir: deps.dataDir,
      projects: deps.projects,
      busy: () =>
        this.queue.state().running.map((k) => {
          const active = this.active.get(k);
          return active ? checkoutKey(active) : taskKey(k);
        }),
      limit: () => this.queue.state().slots,
      finished: (task) => this.finished(task),
      ...(deps.docker ? { docker: deps.docker } : {}),
    });
  }

  /**
   * Merged, cancelled or deleted: the task needs no environment any more. The environment of a
   * stage is named after its milestone and lives while any of its tasks is unfinished.
   */
  private async finished(task: TaskKey): Promise<boolean> {
    try {
      const artifacts = await this.project(task.projectId).load();
      const over = (t: { status: string }) => t.status === 'done' || t.status === 'cancelled';
      const found = artifacts.tasks.find((t) => t.id === task.taskId);
      if (found) return over(found);
      return stageTasks({ id: task.taskId }, artifacts).every(over);
    } catch {
      // A project that cannot be read proves nothing about its tasks.
      return false;
    }
  }

  /** Docker being away must not fail a merge or a deletion; the next pass removes what is left. */
  async removeEnvironment(task: TaskKey): Promise<void> {
    const failures = await this.environments
      .destroy(task)
      .catch((error: unknown) => [String(error)]);
    if (failures.length) console.error(`environment of ${task.taskId}: ${failures.join('; ')}`);
  }

  /** Finished tasks lose their environments; the running ones stay within the slot limit. */
  limitEnvironments(): void {
    void this.environments.enforce().catch(() => undefined);
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
    const context = this.project(projectId);
    const task = await readSubject(context, taskId).catch(() => undefined);
    const stage = task && subjectStage(await context.load(), taskId);
    this.deps.notify(
      kind,
      stage ? stage.title : task ? `${task.id} · ${task.title}` : taskId,
      stage ? stageNotice(kind, stage.id, this.deps.locale()) : undefined,
    );
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
