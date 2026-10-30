import { GitBaseChangedError, LocalChangesChangedError, type ProjectCheck } from '@skaro/core';
import { CompletionMonitor } from './completion-monitor';
import { CompletionStore, type TaskResult } from './completion-store';
import { captureResult } from './completion-capture';
import { acceptedResult, assertResultUnchanged, wasReverted } from './completion-results';
import { publishCandidate, retireCandidates } from './completion-publication';
import { mergeMilestoneTasks } from './completion-milestone';
import { finishCompletion } from './completion-projection';
import { reconcileCompletions } from './completion-recovery';
import type { ProjectContext } from './projects';
import { IntegrationPending, type IntegrationOperation } from './integration-model';
import { assertPublicationDependencies } from './completion-dependencies';
import { publishWithLocalChanges } from './completion-local-publication';
import { assertLocalIntegration } from './integration-local-changes';
import { retryLocalIntegration } from './completion-local-retry';

export type { CompletionHooks } from './completion-hooks';
import type { CompletionHooks } from './completion-hooks';

/** Owns execution facts and publication. It never needs a chat, agent session or timeline. */
export class CompletionCoordinator {
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly mergingNow = new Map<string, string>();
  private readonly monitor: CompletionMonitor;
  private closed = false;
  private readonly hooks: CompletionHooks;
  constructor(hooks: CompletionHooks) {
    this.hooks = {
      ...hooks,
      busy: (projectId, taskId) =>
        this.pending.has(`${projectId}\n${taskId}`) || hooks.busy(projectId, taskId),
    };
    this.monitor = new CompletionMonitor(this.hooks, {
      pending: (projectId) =>
        [...this.pending.keys()].some(
          (key) => key === projectId || key.startsWith(`${projectId}\n`),
        ),
      run: (projectId, action) => this.serialized(projectId, action),
      reconcile: (context) =>
        reconcileCompletions(context, this.hooks, (projectId, taskId, error) =>
          this.monitor.report(projectId, taskId, error),
        ),
      merge: (projectId, target) => this.performMerge(projectId, target),
    });
  }

  changed(projectId: string): void {
    this.monitor.changed(projectId);
  }

  start(): void {
    this.monitor.start();
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.monitor.close();
    await Promise.allSettled(this.pending.values());
  }

  idle(projectId: string): Promise<unknown> {
    return Promise.all(
      [...this.pending]
        .filter(([key]) => key === projectId || key.startsWith(`${projectId}\n`))
        .map(([, pending]) => pending),
    );
  }

  async serialized<T>(projectId: string, action: () => Promise<T>): Promise<T> {
    if (this.closed) throw new Error('Completion service is closing');
    const previous = this.pending.get(projectId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    this.pending.set(projectId, next);
    try {
      return await next;
    } finally {
      if (this.pending.get(projectId) === next) this.pending.delete(projectId);
    }
  }

  capture(
    projectId: string,
    taskId: string,
    branch: string,
    worktree: string,
    message: string,
    summary?: string,
    verification?: ProjectCheck[],
  ): Promise<void> {
    return this.serialized(`${projectId}\n${taskId}`, () =>
      captureResult(this.hooks, {
        projectId,
        taskId,
        branch,
        worktree,
        message,
        summary,
        verification,
      }),
    ).then(() => this.monitor.changed(projectId));
  }

  /** The task whose result is being merged into the base branch right now. */
  merging(projectId: string): string | undefined {
    return this.mergingNow.get(projectId);
  }

  /** Merges a task; a milestone id merges its accepted tasks one by one, dependencies first. */
  merge(projectId: string, target: string, _partial = false, message?: string) {
    return this.serialized(projectId, async () => {
      await this.captured(projectId);
      return this.performMerge(projectId, target, message);
    });
  }

  /** Publishes a candidate that an integration resolved before merges went per task. */
  publishCandidate(candidate: IntegrationOperation) {
    return this.serialized(candidate.projectId, async () => {
      await this.captured(candidate.projectId);
      try {
        await assertLocalIntegration(this.hooks.deps.projects.get(candidate.projectId), candidate);
        return await this.mergeResults(
          candidate.projectId,
          candidate.results.map((result) => result.taskId),
          candidate.message,
          candidate,
        );
      } catch (error) {
        if (
          !candidate.localChanges ||
          !(error instanceof LocalChangesChangedError || error instanceof GitBaseChangedError)
        )
          throw error;
        return this.retryCandidate(candidate, error);
      }
    });
  }

  /** A candidate prepared without part of the owner's related edits starts again with them. */
  rescopeCandidate(candidate: IntegrationOperation, paths: string[]) {
    return this.serialized(candidate.projectId, async () => {
      await this.captured(candidate.projectId);
      return this.retryCandidate(candidate, new LocalChangesChangedError(paths));
    });
  }

  private async retryCandidate(candidate: IntegrationOperation, error: unknown) {
    const next = await retryLocalIntegration(this.hooks, candidate, error);
    return this.mergeResults(
      next.projectId,
      next.results.map((result) => result.taskId),
      next.message,
      next,
    );
  }

  private captured(projectId: string): Promise<unknown> {
    return Promise.all(
      [...this.pending]
        .filter(([key]) => key.startsWith(`${projectId}\n`))
        .map(([, pending]) => pending),
    );
  }

  private async performMerge(
    projectId: string,
    target: string,
    message?: string,
  ): Promise<{ commit: string; base: string }> {
    const context = this.hooks.deps.projects.get(projectId);
    context.invalidate();
    const artifacts = await context.load();
    if (artifacts.tasks.some((item) => item.id === target))
      return this.mergeResults(projectId, [target], message);
    return mergeMilestoneTasks(
      this.hooks,
      projectId,
      target,
      (taskId, text) => this.mergeResults(projectId, [taskId], text),
      message,
    );
  }

  /** One publication: a task, or the tasks of a candidate resolved before merges went per task. */
  private async mergeResults(
    projectId: string,
    ids: string[],
    message?: string,
    candidate?: IntegrationOperation,
  ): Promise<{ commit: string; base: string }> {
    const target = ids[0]!;
    const context = this.hooks.deps.projects.get(projectId);
    await this.reconcile(context);
    context.invalidate();
    const artifacts = await context.load();
    const configProblems = artifacts.problems.filter(
      (problem) => problem.path === '.skaro/config.yaml',
    );
    if (configProblems.length)
      throw new Error(configProblems.map((problem) => problem.message).join('\n'));
    const scope = artifacts.tasks.filter((item) => ids.includes(item.id));
    if (!scope.length) throw new Error(`No tasks to merge: ${target}`);
    const stage = candidate
      ? artifacts.milestones.find((item) => item.id === candidate.target)
      : undefined;
    const tasks = scope.filter((item) => item.status === 'review');
    const store = new CompletionStore(this.hooks.deps.db, projectId);
    if (!tasks.length) {
      const completed = store
        .operations()
        .findLast(
          (op) =>
            op.state === 'completed' &&
            op.results.some((result) => scope.some((item) => item.id === result.taskId)),
        );
      if (completed?.commit) return { commit: completed.commit, base: completed.base };
      throw new Error(`${target}: no accepted results awaiting merge`);
    }
    const results: TaskResult[] = [];
    for (const item of tasks) results.push(await acceptedResult(this.hooks.deps.db, context, item));
    assertPublicationDependencies(artifacts, results, store);
    for (const result of results) {
      if (wasReverted(store, result))
        throw new Error(`${result.taskId}: merge was reverted; submit a revised result`);
      await assertResultUnchanged(context, result);
    }
    const operation =
      store
        .operations()
        .findLast(
          (op) =>
            op.state === 'integrating' &&
            op.base === artifacts.config.baseBranch &&
            JSON.stringify(op.results.map((r) => r.head)) ===
              JSON.stringify(results.map((r) => r.head)),
        ) ?? store.create(artifacts.config.baseBranch, results, artifacts.config.merge.strategy);
    const text =
      message?.trim() ||
      (stage
        ? `${stage.id}: ${stage.title}\n\n${results.map((r) => r.message).join('\n')}`
        : results[0]!.message);
    try {
      if (candidate) {
        if (
          JSON.stringify(candidate.results.map((r) => r.head)) !==
          JSON.stringify(results.map((r) => r.head))
        )
          throw new Error(`${target}: accepted results changed after the candidate was resolved`);
        operation.integrationId = candidate.id;
        store.save(operation);
        await publishCandidate(
          context,
          artifacts,
          store,
          operation,
          text,
          this.hooks.integrations,
          candidate,
        );
      } else {
        // The older candidates of the task are over: its merge is a Git operation of its own.
        retireCandidates(this.hooks.integrations, projectId, ids);
        this.mergingNow.set(projectId, target);
        this.hooks.deps.emit('project.changed', { projectId });
        try {
          await publishWithLocalChanges(
            context,
            artifacts,
            store,
            operation,
            text,
            this.hooks.integrations,
          );
        } finally {
          this.mergingNow.delete(projectId);
        }
      }
      await finishCompletion(this.hooks, context, store, operation);
      if (candidate) {
        candidate.state = 'applied';
        this.hooks.integrations.save(candidate);
      }
      return { commit: operation.commit!, base: operation.base };
    } catch (error) {
      // A published candidate must be projected even if a later notification failed.
      operation.error = String(error);
      if (error instanceof IntegrationPending) {
        operation.state = 'integrating';
        operation.integrationId = error.operation.id;
        delete operation.error;
      } else if (operation.state !== 'completed') operation.state = 'failed';
      store.save(operation);
      this.hooks.deps.emit('project.changed', { projectId });
      throw error;
    }
  }

  private reconcile(context: ProjectContext): Promise<void> {
    return reconcileCompletions(context, this.hooks, (projectId, taskId, error) =>
      this.monitor.report(projectId, taskId, error),
    );
  }
}
