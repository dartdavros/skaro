import type { SkaroScope, ToolResult } from '@skaro/mcp-server';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import { taskC4Protocol } from './c4-protocol';
import { C4SemanticStore } from './c4-semantic-store';
import { c4SemanticSnapshot } from './c4-semantic-snapshot';
import { bindC4Coordination } from './c4-coordination-binding';
import { requireCoordinationDispatch } from './coordination-dispatch';
import { inspectSemanticC4Review } from './c4-semantic-gate';
import { executeC4Review } from './c4-review-execution';
import { key } from './task-run-helpers';
import { resourcesFor } from './resource-execution';
import { reconcileFailedC4Reviews } from './c4-review-reconciliation';

/** Durable requests, task lifecycle and scheduling; semantic execution lives in its own module. */
export class C4TaskCoordination {
  private readonly ctx: TaskRunEngine;
  private readonly running = new Map<
    string,
    { run: string; abort: AbortController; promise: Promise<void> }
  >();
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
    bindC4Coordination(ctx.deps.db, this);
  }
  private get store() {
    return new C4SemanticStore(this.ctx.deps.db);
  }
  async requestScope(scope: SkaroScope, packageId?: string) {
    const active = scope.taskId
      ? this.ctx.active.get(key(scope.projectId, scope.taskId))
      : undefined;
    if (scope.kind !== 'task' || !active || active.run.id !== scope.runId)
      throw new Error('C4 review requires the current live task owner');
    return this.request(active, packageId);
  }
  async request(active: ActiveRun, packageId?: string): Promise<ToolResult> {
    const { projectId, taskId, run } = active,
      db = this.ctx.deps.db;
    if (taskC4Protocol(db, projectId, run.id) !== 'impact-v1')
      throw new Error('Task is pinned to legacy C4');
    const execution = this.ctx.continuation.execution(active);
    if (!execution.read().enabled)
      throw new Error('C4 verification needs current task execution intent');
    await reconcileFailedC4Reviews(this.ctx, projectId, run.id, execution.intentVersion());
    const snapshot = await c4SemanticSnapshot(db, this.ctx.project(projectId), taskId, run.id);
    const dispatchRevision = requireCoordinationDispatch(db, projectId).revision,
      intent = execution.intentVersion();
    const id = C4SemanticStore.id(projectId, run.id, snapshot.fingerprint, intent, packageId);
    const job = this.store.request({
      version: 1,
      id,
      projectId,
      taskId,
      runId: run.id,
      intent,
      dispatchRevision,
      fingerprint: snapshot.fingerprint,
      contextHash: snapshot.contextHash,
      observation: snapshot.observation,
      packageId,
      state: 'queued',
    });
    const failed =
      ['failed', 'uncertain'].includes(job.state) ||
      (job.state === 'verified' && job.verdict?.implementation !== 'aligned');
    return {
      text:
        job.state === 'queued' || job.state === 'running'
          ? `Skaro queued independent C4 verification ${id}. No result or permission is claimed. End this turn so the verifier can use released capacity; do not poll or ask for routine C4 approval.`
          : job.state === 'verified'
            ? `Independent C4 review: ${job.verdict?.summary}. Re-read current context before submitting.`
            : `Independent C4 review requires renewed owner intent: ${job.error ?? job.state}`,
      ...(failed ? { isError: true } : {}),
      structuredContent: { id, state: job.state },
    };
  }
  async submission(active: ActiveRun): Promise<ToolResult | undefined> {
    if (taskC4Protocol(this.ctx.deps.db, active.projectId, active.run.id) !== 'impact-v1')
      return undefined;
    const current = await c4SemanticSnapshot(
      this.ctx.deps.db,
      this.ctx.project(active.projectId),
      active.taskId,
      active.run.id,
      false,
    );
    if (current.observation.scope.kind === 'artifacts') return undefined;
    try {
      await inspectSemanticC4Review(
        this.ctx.deps.db,
        this.ctx.project(active.projectId),
        active.taskId,
        active.run.id,
      );
      return undefined;
    } catch {
      return this.request(active);
    }
  }
  async afterTurn(active: ActiveRun): Promise<boolean> {
    const job = this.store.current(active.run.id);
    if (!job) return false;
    if (job.state === 'verified' && job.delivered)
      return (
        job.verdict?.implementation !== 'aligned' ||
        !['aligned', 'optional'].includes(job.verdict.category)
      );
    if (this.running.has(job.id) || !['queued', 'verified'].includes(job.state)) return true;
    if (
      !this.ctx.continuation.execution(active).read().enabled ||
      active.timeline.state.interactions.length
    )
      return true;
    await this.ctx.sessions.detach(active);
    const abort = new AbortController();
    const promise = executeC4Review(this.ctx, job, active, abort.signal)
      .catch((error: unknown) => {
        const current = this.store.get(job.id);
        if (current && ['queued', 'running'].includes(current.state))
          this.store.update(current, { state: 'failed', error: String(error) });
        this.ctx.history.notice(active, 'other', 'error', String(error));
        this.ctx.setRuntime(job.projectId, job.taskId, 'failed', job.runId);
      })
      .finally(() => this.running.delete(job.id));
    this.running.set(job.id, { run: job.runId, abort, promise });
    return true;
  }
  async stop(project: string, task: string) {
    const run = this.ctx.deps.db.latestRun(project, task);
    const entries = [...this.running.entries()].filter(([, entry]) => entry.run === run?.id);
    for (const [, entry] of entries) entry.abort.abort(new Error('C4 review stopped by owner'));
    await Promise.all(entries.map(([, entry]) => entry.promise));
    for (const [id] of entries) {
      const job = this.store.get(id);
      if (job?.worker) {
        await this.ctx.processes.stop(job.worker);
        resourcesFor(this.ctx.deps.db)?.reconcileProcess(project, job.worker);
      }
    }
  }
  async recover(project: string, task: string) {
    const run = this.ctx.deps.db.latestRun(project, task);
    if (!run) return false;
    const job = this.store.current(run.id);
    if (!job) return false;
    if (job.state === 'running') {
      if (job.worker) await this.ctx.processes.stop(job.worker);
      resourcesFor(this.ctx.deps.db)?.releaseOwner(
        project,
        `c4-review:${job.id}`,
        'independent_reviewer_exit_confirmed_during_recovery',
      );
      const uncertain = this.store.update(job, {
        state: 'uncertain',
        error: 'Interrupted review; actual old process stopped. Renewed owner intent is required.',
      });
      const active = await this.ctx.history.restore(project, task);
      if (active) this.ctx.history.notice(active, 'other', 'error', uncertain.error!);
      this.ctx.setRuntime(project, task, 'failed', run.id);
      return true;
    }
    if (job.state === 'verified' && job.delivered)
      return (
        job.verdict?.implementation !== 'aligned' ||
        !['aligned', 'optional'].includes(job.verdict.category)
      );
    if (!['queued', 'verified'].includes(job.state)) return true;
    await this.ctx.processes.stop(run.id);
    const active = await this.ctx.history.restore(project, task);
    return active ? this.afterTurn(active) : false;
  }
  async close() {
    for (const entry of this.running.values())
      entry.abort.abort(new Error('C4 coordinator closing'));
    await Promise.allSettled([...this.running.values()].map((entry) => entry.promise));
  }
}
