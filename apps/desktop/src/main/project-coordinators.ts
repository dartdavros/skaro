import type { AppDb, CoordinationEvidence, CoordinationOperation } from '@skaro/core';
import { coordinationRequest, type ProjectOperationRequest } from './project-coordinator-request';
import { CoordinationPending } from './project-coordinator-errors';
import { dispatchProjectOperation, type CoordinationExecution } from './coordinator-delivery';
import { migrateCoordinatorProject } from './coordinator-migration';
import { requireCoordinationDispatch, dispatchSafetyAction } from './coordination-dispatch';
import { reconcileUnstartedEnvironments } from './environment-operation-recovery';
export type { CoordinationExecution } from './coordinator-delivery';

/** One logical controller per project. Models and executors do not own its durable identity. */
export class ProjectCoordinators {
  private readonly db: AppDb;
  private readonly running = new Map<string, Promise<unknown>>();
  private readonly queues = new Map<string, Promise<void>>();
  private closing = false;
  private recovered = false;
  constructor(db: AppDb) {
    this.db = db;
  }

  private requireProject(projectId: string): void {
    if (this.db.shell.projectScope && this.db.shell.projectScope !== projectId)
      throw new Error('Project is outside verification scope');
    if (!this.db.getProject(projectId)) throw new Error('Coordinator project is not registered');
  }

  version(projectId: string): number {
    this.requireProject(projectId);
    return this.db.coordination.ensure(projectId).version;
  }

  /** Called once behind the host single-instance lock, before any service recovery or delivery. */
  recover(): void {
    if (this.running.size || this.recovered)
      throw new Error('Coordinator recovery already started');
    this.recovered = true;
    for (const project of this.db.shell.list()) {
      this.db.coordination.ensure(project.id);
      migrateCoordinatorProject(this.db, project.id);
      this.db.coordination.recover(project.id);
      reconcileUnstartedEnvironments(this.db, project.id);
      for (const operation of this.db.coordination.pending(project.id)) {
        if (operation.state !== 'queued' || operation.action.startsWith('owner.')) continue;
        this.db.coordination.reject(project.id, operation.id, {
          expectedRevision: operation.revision,
          evidence: { code: 'restart_requires_new_request', refs: [operation.subject] },
        });
      }
    }
  }

  execute<T>(
    request: ProjectOperationRequest,
    effect: () => T | Promise<T>,
    options: CoordinationExecution<T> = {},
  ): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Project coordination is closing'));
    this.requireProject(request.projectId);
    const safety =
      request.mode === 'observation' ||
      dispatchSafetyAction(request.action) ||
      options.whileSuspended === true;
    const revision = safety
      ? undefined
      : requireCoordinationDispatch(this.db, request.projectId).revision;
    // Validate exact replay before reusing a live Promise; changed payload is never an alias.
    const operation = this.db.coordination.accept(coordinationRequest(request));
    const key = JSON.stringify([request.projectId, operation.id]);
    const previous = this.running.get(key);
    if (previous) return previous as Promise<T>;
    const queueKey = JSON.stringify([request.projectId, request.scopeKey]);
    const before = this.queues.get(queueKey) ?? Promise.resolve();
    const next = before.then(() =>
      this.dispatch(operation, effect, {
        ...options,
        validate: async () => {
          if (!safety) requireCoordinationDispatch(this.db, request.projectId, revision);
          await options.validate?.();
          if (!safety) requireCoordinationDispatch(this.db, request.projectId, revision);
        },
      }),
    );
    this.running.set(key, next);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(queueKey, settled);
    void settled.then(() => {
      if (this.running.get(key) === next) this.running.delete(key);
      if (this.queues.get(queueKey) === settled) this.queues.delete(queueKey);
    });
    return next;
  }

  private async dispatch<T>(
    accepted: CoordinationOperation,
    effect: () => T | Promise<T>,
    options: CoordinationExecution<T>,
  ): Promise<T> {
    this.requireProject(accepted.projectId);
    if (this.closing)
      throw new CoordinationPending(
        this.db.coordination.getOperation(accepted.projectId, accepted.id)!,
      );
    return dispatchProjectOperation(this.db.coordination, accepted, effect, {
      ...options,
      validate: async () => {
        this.requireProject(accepted.projectId);
        await options.validate?.();
        this.requireProject(accepted.projectId);
        if (this.closing)
          throw new CoordinationPending(
            this.db.coordination.getOperation(accepted.projectId, accepted.id)!,
          );
      },
    });
  }

  reconcile(
    projectId: string,
    id: string,
    evidence: CoordinationEvidence,
    state: 'succeeded' | 'failed',
  ): CoordinationOperation {
    this.requireProject(projectId);
    const operation = this.db.coordination.getOperation(projectId, id);
    if (!operation) throw new Error('Project operation does not exist');
    return this.db.coordination.reconcile(projectId, id, {
      expectedRevision: operation.revision,
      state,
      evidence,
    });
  }

  stopAccepting(): void {
    this.closing = true;
  }
  stopping(): boolean {
    return this.closing;
  }
  async close(): Promise<void> {
    this.stopAccepting();
    await Promise.allSettled(this.running.values());
  }
}
