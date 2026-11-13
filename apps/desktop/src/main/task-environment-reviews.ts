import { randomUUID } from 'node:crypto';
import { resourcesFor } from './resource-execution';
import {
  savedEnvironmentReviews,
  saveEnvironmentReviews,
  recoverEnvironmentReviews,
} from './environment-review-persistence';
import type { TaskKey } from '@skaro/core';
import type { TaskView } from '../shared/ipc';
import type { TaskRunEngine } from './task-run-engine';
import { key } from './task-run-helpers';
import { checkoutKey } from './task-stage';
import { readSubject } from './task-subject';
import { taskRunDirectory } from './task-run-directory';
import {
  EnvironmentReview as Review,
  type SavedEnvironmentReview as SavedReview,
} from './task-environment-review-state';

export function reviewQueueKey(task: TaskKey): string {
  return `${task.projectId}\n@review:${task.taskId}`;
}
export function isReviewQueueKey(value: string): boolean {
  return value.split('\n')[1]?.startsWith('@review:') ?? false;
}

/** Explicit human use owns one queue slot until Finish review, merge, deletion or app shutdown. */
export class TaskEnvironmentReviews {
  private readonly entries = new Map<string, Review>();
  private closed = false;
  private recovery: Promise<void> | undefined;
  private recovered = false;
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
    // Recovery failures must be reported and must prevent another launch on top of old processes.
    void Promise.resolve()
      .then(() => this.ensureRecovered())
      .catch((error) => console.error('Environment review recovery:', error));
  }

  state(projectId: string, taskId: string): TaskView['environmentReview'] {
    return this.entries.get(reviewQueueKey({ projectId, taskId }))?.state;
  }

  environment(queueKey: string): TaskKey | undefined {
    return this.entries.get(queueKey)?.environment;
  }

  /** Recovery and a failed stop still own their services until shutdown is proved. */
  protectedEnvironments(): TaskKey[] {
    const pending = this.recovered ? [] : savedEnvironmentReviews(this.ctx.deps.db);
    return [
      ...pending,
      ...[...this.entries.values()].filter(
        (review) =>
          review.state !== 'queued' ||
          this.ctx.queue.state().running.includes(reviewQueueKey(review)),
      ),
    ].map((review) => review.environment);
  }

  ready(): Promise<void> {
    return this.ensureRecovered();
  }

  owns(environment: TaskKey): boolean {
    return [...this.entries.values()].some(
      (review) =>
        (review.state !== 'queued' ||
          this.ctx.queue.state().running.includes(reviewQueueKey(review))) &&
        key(review.environment.projectId, review.environment.taskId) ===
          key(environment.projectId, environment.taskId),
    );
  }

  blocked(queueKey: string): boolean {
    const review = this.entries.get(queueKey);
    if (!review) return false;
    const owner = key(review.environment.projectId, review.environment.taskId);
    return (
      this.ctx.integrations.ownsTask(review.projectId, review.taskId) ||
      this.ctx.handoff.blocked(key(review.projectId, review.taskId)) ||
      this.ctx.queue.state().running.some((running) => {
        const active = this.ctx.active.get(running);
        const other = this.environment(running) ?? (active && checkoutKey(active));
        return other && key(other.projectId, other.taskId) === owner;
      })
    );
  }

  async open(
    projectId: string,
    taskId: string,
    url: string,
    open: (url: string) => Promise<void>,
  ): Promise<void> {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol))
      throw new Error('Only web links open externally.');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) return open(url);
    await this.ensureRecovered();
    if (this.closed) throw new Error('Skaro is closing.');
    const active = await this.ctx.history.restore(projectId, taskId);
    const environment = active ? checkoutKey(active) : { projectId, taskId };
    const port = this.ctx.environments.link(environment, url);
    if (!port) return open(url);
    if (!active?.run.worktree) throw new Error('The task has no isolated checkout to review.');
    taskRunDirectory(this.ctx.project(projectId).root, active.run);
    const task = await readSubject(this.ctx.project(projectId), taskId);
    if (['done', 'cancelled'].includes(task.status))
      throw new Error('This task is already completed.');
    const queueKey = reviewQueueKey({ projectId, taskId });
    let review = this.entries.get(queueKey);
    if (!review) {
      review = new Review({
        projectId,
        taskId,
        environment,
        id: `environment-review-${randomUUID()}`,
      });
      this.entries.set(queueKey, review);
      this.save();
      this.changed(review);
      const result = this.ctx.queue.enqueue([queueKey]);
      if (!result.accepted.length) {
        this.entries.delete(queueKey);
        this.save();
        throw new Error(result.rejected[queueKey] ?? 'Could not queue environment review.');
      }
    }
    await review.ready.promise;
    if (!review.cancelled) await open(this.ctx.environments.linkAddress(environment, url, port));
  }

  async run(queueKey: string): Promise<void> {
    const review = this.entries.get(queueKey);
    if (!review) return;
    review.state = 'starting';
    this.changed(review);
    try {
      await this.ensureRecovered();
      if (review.cancelled) return;
      review.holding = await resourcesFor(this.ctx.deps.db)?.acquire('review');
      const task = await readSubject(this.ctx.project(review.projectId), review.taskId);
      if (['done', 'cancelled'].includes(task.status))
        throw new Error('This task is already completed.');
      await this.ctx.environments.start(review.environment, {
        signal: review.controller.signal,
        processStarted: (pid) => this.ctx.processes.startedAsync(review.id, pid, true),
        assertActive: () => {
          if (review.cancelled) throw new Error('Environment review cancelled.');
        },
      });
      if (review.cancelled) return;
      const environment = await this.ctx.environments.describe(review.environment);
      const resource = this.ctx.deps.db.resources
        .list(review.projectId)
        .find((record) => record.identity.composeProject === environment.identity.name);
      if (review.holding) {
        if (!resource) throw new Error('Review environment resource is not registered');
        review.holding.bind([
          { resourceId: resource.id, generation: resource.generation, mode: 'shared' },
        ]);
      }
      review.state = 'running';
      this.changed(review);
      review.ready.resolve();
      await review.ended.promise;
    } catch (error) {
      if (!review.cancelled) review.ready.reject(error);
    } finally {
      review.ready.resolve();
      try {
        await this.cleanup(review);
        review.stopped.resolve();
      } catch (error) {
        review.cleanupFailed = true;
        review.stopped.reject(error);
        this.ctx.deps.notify?.('error', `${review.taskId}: ${String(error)}`);
        // A failed stop cannot make its capacity available to a different environment.
        await review.released.promise;
      }
    }
  }

  async stop(projectId: string, taskId: string): Promise<void> {
    resourcesFor(this.ctx.deps.db)?.stopOwner(projectId, `review:${taskId}`);
    const queueKey = reviewQueueKey({ projectId, taskId });
    const review = this.entries.get(queueKey);
    if (!review) return;
    review.cancelled = true;
    if (review.cleanupFailed) {
      await this.cleanup(review);
      review.released.resolve();
      return;
    }
    if (!this.ctx.queue.state().running.includes(queueKey)) {
      this.ctx.queue.cancel(queueKey);
      if (review.state !== 'queued') return this.cleanup(review);
      this.entries.delete(queueKey);
      this.save();
      review.ready.resolve();
      review.stopped.resolve();
      this.changed(review);
      return;
    }
    // Kill the owned process tree before aborting its shell/readiness, including on Windows.
    await this.ctx.processes.stop(review.id);
    review.controller.abort();
    review.ended.resolve();
    await review.stopped.promise;
  }

  async stopEnvironment(environment: TaskKey): Promise<void> {
    for (const review of [...this.entries.values()])
      if (
        key(review.environment.projectId, review.environment.taskId) ===
        key(environment.projectId, environment.taskId)
      )
        await this.stop(review.projectId, review.taskId);
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.ensureRecovered();
    for (const review of [...this.entries.values()])
      await this.stop(review.projectId, review.taskId);
  }

  private save(): void {
    saveEnvironmentReviews(
      this.ctx.deps.db,
      [...this.entries.values()].map(({ projectId, taskId, id, environment }) => ({
        projectId,
        taskId,
        id,
        environment,
      })),
    );
  }

  private async cleanup(review: Review): Promise<void> {
    await this.ctx.processes.stop(review.id);
    // Keep ownership until services have really stopped; only then can another writer start.
    await this.ctx.environments.stop(review.environment, review.holding, true);
    resourcesFor(this.ctx.deps.db)?.releaseOwner(
      review.projectId,
      `review:${review.taskId}`,
      'manual_review_and_services_stopped',
    );
    this.entries.delete(reviewQueueKey(review));
    this.save();
    this.changed(review);
    this.ctx.queue.poke();
  }

  private changed(review: SavedReview): void {
    this.ctx.changed(review.projectId, review.taskId);
    this.ctx.deps.emit('project.changed', { projectId: review.projectId });
  }

  private ensureRecovered(): Promise<void> {
    if (this.recovered) return Promise.resolve();
    return (this.recovery ??= this.recover()
      .then(() => {
        this.recovered = true;
      })
      .finally(() => {
        this.recovery = undefined;
      }));
  }

  private async recover(): Promise<void> {
    await recoverEnvironmentReviews(this.ctx);
  }
}
