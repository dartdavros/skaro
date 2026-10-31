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
import { TaskRunHandoff } from './task-run-handoff';
import { TaskRunProcesses } from './task-run-processes';
import { checkoutKey } from './task-stage';
import { readSubject, subjectStage } from './task-subject';
import { stageNotice } from './stage-views';
import { errorText } from './session-log';
import { TaskIntegrations } from './task-integrations';
import { TaskStartup } from './task-startup';
import { TaskEnvironmentReviews, isReviewQueueKey } from './task-environment-reviews';
import { taskEnvironmentFinished } from './task-environment-finished';
import { TaskRunContinuation } from './task-run-continuation';

function taskKey(k: string): TaskKey {
  const [projectId, taskId] = k.split('\n') as [string, string];
  return { projectId, taskId };
}

/** Shared state and composition of the task-run services. */
export class TaskRunEngine {
  closing = false;
  readonly continuation = new TaskRunContinuation(this);
  readonly deps: TaskRunDeps;
  readonly active = new Map<string, ActiveRun>();
  /** Messages that wait for a queue slot, in the order they were sent. */
  readonly queuedInputs = new Map<string, MessageInput[]>();
  readonly queue: RunQueue;
  readonly merges: TaskMerges;
  readonly environments: TaskEnvironments;
  readonly reviews: TaskEnvironmentReviews;
  readonly integrations: TaskIntegrations;
  readonly startup: TaskStartup;
  readonly views = new TaskRunViews(this);
  readonly scheduling = new TaskRunScheduling(this);
  readonly messages = new TaskRunMessages(this);
  readonly results = new TaskRunResults(this);
  readonly mergeActions = new TaskRunMergeActions(this);
  readonly sessions = new TaskRunSessions(this);
  readonly events = new TaskRunEvents(this);
  readonly history = new TaskRunHistory(this);
  readonly stages = new TaskRunStages(this);
  readonly handoff = new TaskRunHandoff(this);
  readonly processes: TaskRunProcesses;
  constructor(deps: TaskRunDeps, slots = 3) {
    this.deps = deps;
    this.processes = new TaskRunProcesses(deps.db);
    this.startup = new TaskStartup(deps.db);
    this.integrations = new TaskIntegrations(this);
    this.merges = new TaskMerges({
      deps,
      integrations: this.integrations.service,
      active: () => [...this.active.values()],
      restore: (projectId, taskId) => this.history.restore(projectId, taskId),
      project: (id) => this.project(id),
      skaroEvent: (active, event) => this.history.skaroEvent(active, event),
      settleRuntime: (active) => this.events.settleRuntime(active),
      changed: (projectId, taskId) => this.changed(projectId, taskId),
      launchUnblocked: (projectId, ids) => this.scheduling.launchUnblocked(projectId, ids),
      detach: (active) => this.sessions.detach(active),
      conflicted: (active, conflicts) => this.mergeActions.conflicted(active, conflicts),
      setRuntime: (projectId, taskId, state) => this.setRuntime(projectId, taskId, state),
      removeEnvironment: (projectId, taskId) => this.removeEnvironment({ projectId, taskId }),
    });
    this.queue = new RunQueue({
      slots,
      canRun: () => undefined,
      blocked: (key) => {
        if (isReviewQueueKey(key)) return this.reviews.blocked(key);
        const op = this.integrations.operation(key);
        const active = this.active.get(key);
        return op
          ? this.integrations.blocked(op)
          : this.reviews.owns(active ? checkoutKey(active) : taskKey(key)) ||
              this.integrations.ownsTask(taskKey(key).projectId, taskKey(key).taskId) ||
              this.handoff.blocked(key) ||
              this.stages.blocked(key);
      },
      start: async (key) => {
        if (isReviewQueueKey(key)) return this.reviews.run(key);
        await this.reviews.ready();
        const op = this.integrations.operation(key);
        return op ? this.integrations.run(op) : this.scheduling.begin(key);
      },
    });
    this.queue.on((event) => {
      if (isReviewQueueKey(event.taskId)) {
        if (event.type === 'finished') this.limitEnvironments();
        return;
      }
      const operation = this.integrations.operation(event.taskId);
      const { projectId, taskId } = operation ?? taskKey(event.taskId);
      const setRuntime = (state: TaskRuntime) =>
        operation
          ? this.integrations.setRuntime(operation, state)
          : this.setRuntime(projectId, taskId, state);
      if (event.type === 'queued') setRuntime('queued');
      if (event.type === 'finished' && event.error) {
        this.startup.fail(projectId, taskId, errorText(event.error));
        const active = this.active.get(key(projectId, taskId));
        if (active) this.history.notice(active, 'other', 'error', errorText(event.error));
        setRuntime('failed');
        deps.db.addEvent(projectId, 'task_failed', { task: taskId, error: errorText(event.error) });
        deps.notify?.('error', `${taskId}: ${errorText(event.error)}`);
      }
      if (event.type === 'finished') this.limitEnvironments();
    });
    this.environments = new TaskEnvironments({
      db: deps.db,
      dataDir: deps.dataDir,
      projects: deps.projects,
      busy: () => [
        ...this.reviews.protectedEnvironments(),
        ...[...this.active.values()].filter((active) => active.afterTurn).map(checkoutKey),
        ...this.queue.state().running.map((k) => {
          const review = this.reviews.environment(k);
          if (review) return review;
          const active = this.active.get(k);
          const op = this.integrations.operation(k);
          return op
            ? { projectId: op.projectId, taskId: `integration-${op.id}` }
            : active
              ? checkoutKey(active)
              : taskKey(k);
        }),
      ],
      finished: async (task) => {
        if (
          !(await taskEnvironmentFinished(
            { db: deps.db, projects: deps.projects, integrations: this.integrations.store },
            task,
          ))
        )
          return false;
        // After a crash, terminal metadata alone does not prove its old agent has exited.
        for (const run of deps.db.listRuns(task.projectId)) {
          const owner = checkoutKey({ projectId: run.projectId, taskId: run.taskId, run });
          if (owner.taskId === task.taskId) await this.processes.stop(run.id);
        }
        return true;
      },
      ...(deps.docker ? { docker: deps.docker } : {}),
    });
    this.reviews = new TaskEnvironmentReviews(this);
    setImmediate(
      () =>
        void this.integrations
          .recover()
          .catch((error) => console.error('Integration recovery:', error))
          .finally(() => {
            if (!this.integrations.closing) this.merges.start();
          }),
    );
  }

  /** Docker being away must not fail a merge or a deletion; the next pass removes what is left. */
  async removeEnvironment(task: TaskKey): Promise<void> {
    await this.reviews.stopEnvironment(task);
    const failures = await this.environments
      .destroy(task)
      .catch((error: unknown) => [String(error)]);
    if (failures.length) console.error(`environment of ${task.taskId}: ${failures.join('; ')}`);
  }

  /** Finished tasks lose their environments; idle services always stop. */
  limitEnvironments(): void {
    void this.environments.enforce().catch((error) => console.error('Environment cleanup:', error));
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
