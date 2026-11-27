import { randomUUID } from 'node:crypto';
import { modelDispatchScope } from './model-dispatch-scope';
import { dispatchState } from './coordination-dispatch';
import {
  type AppDb,
  type ResourceCost,
  type ResourceLease,
  type ResourceLeaseRequest,
  type ResourceRecord,
} from '@skaro/core';
import { resourceHolding } from './resource-holding';
import { reserveModelWork } from './resource-model-work';
import { ResourceManager } from './resource-manager';
import { resourceVolume } from './resource-budget';
import { resourceWorkCost, type ResourceWork } from './resource-policy';
import {
  bindApplicationResources,
  resourceExecution,
  type ResourceExecution,
  type HeldResource,
} from './resource-execution';

/** Owner cancellation and durable resource identity; no resource scarcity admission. */
export class ApplicationResources {
  readonly manager: ResourceManager;
  private readonly db: AppDb;
  private readonly dataDir: string;
  private readonly shutdown = new AbortController();
  private readonly owners = new Map<string, Set<AbortController>>();
  constructor(db: AppDb, dataDir: string) {
    this.db = db;
    this.dataDir = dataDir;
    bindApplicationResources(db, this);
    this.manager = new ResourceManager(db, (lease) =>
      db.addEvent(lease.projectId, 'resource_admission', {
        id: lease.id,
        owner: lease.ownerId,
        checkpoint: lease.checkpoint,
        state: lease.state,
        reason: lease.reason,
        revision: lease.revision,
      }),
    );
    const projects = new Set(db.shell.list().map((project) => project.id));
    for (const lease of db.admission.all()) {
      if (!projects.has(lease.projectId)) continue;
      if (['waiting_resource', 'waiting_quota'].includes(lease.state))
        db.admission.cancel(
          lease.projectId,
          lease.id,
          lease.revision,
          'restart_requires_readmission',
        );
      else if (lease.state === 'granted')
        db.admission.retain(lease.projectId, lease.id, lease.revision);
    }
  }

  async scope<T>(
    projectId: string,
    ownerId: string,
    action: () => Promise<T>,
    options: {
      signal?: AbortSignal;
      intentId?: string;
      dispatchRevision?: number;
      requireCurrent?: () => void | Promise<void>;
      changed?: () => void;
    } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const key = JSON.stringify([projectId, ownerId]);
    const owners = this.owners.get(key) ?? new Set<AbortController>();
    owners.add(controller);
    this.owners.set(key, owners);
    const signal = AbortSignal.any([
      this.shutdown.signal,
      controller.signal,
      ...(options.signal ? [options.signal] : []),
    ]);
    const scope: ResourceExecution = {
      resources: this,
      projectId,
      ownerId,
      intentId: options.intentId ?? randomUUID(),
      dispatchRevision:
        options.dispatchRevision ??
        (/^(task|review|integration):/.test(ownerId)
          ? undefined
          : dispatchState(this.db, projectId).revision),
      signal,
      changed: options.changed,
      requireCurrent: async () => {
        signal.throwIfAborted();
        if (
          (this.db.shell.projectScope && this.db.shell.projectScope !== projectId) ||
          !this.db.getProject(projectId)
        )
          throw new Error('Resource owner project no longer exists');
        await options.requireCurrent?.();
        signal.throwIfAborted();
      },
    };
    try {
      await scope.requireCurrent();
      return await resourceExecution.run(scope, action);
    } finally {
      owners.delete(controller);
      if (!owners.size) this.owners.delete(key);
    }
  }

  async acquire(
    kind: ResourceWork,
    scope = resourceExecution.getStore(),
    options: {
      account?: string;
      locks?: ResourceLeaseRequest['locks'];
      checkpoint?: string;
      cost?: ResourceCost;
      wait?: boolean;
    } = {},
  ): Promise<HeldResource> {
    scope = modelDispatchScope(this.db, kind, scope);
    if (!scope) throw new Error('Resource execution requires a bound owner');
    await scope.requireCurrent();
    const volume = await resourceVolume(this.dataDir);
    const cost = options.cost ?? resourceWorkCost(this.db, kind, volume);
    const project = this.db.getProject(scope.projectId);
    if (project && !options.cost && Object.keys(cost.diskBytes).length) {
      const rootVolume = await resourceVolume(project.path);
      cost.diskBytes[rootVolume] ??= Math.max(...Object.values(cost.diskBytes));
    }
    const lease = await this.manager.acquire(
      {
        id: randomUUID(),
        projectId: scope.projectId,
        ownerId: scope.ownerId,
        intentId: scope.intentId,
        checkpoint: options.checkpoint ?? kind,
        cost,
        locks: options.locks ?? [],
        ...(options.account ? { account: options.account } : {}),
      },
      { ...scope, wait: options.wait },
    );
    const held = resourceHolding(this.db, this.manager, lease);
    try {
      await scope.requireCurrent();
    } catch (error) {
      held.release('dispatch_revoked_before_effect');
      throw error;
    }
    return held;
  }

  /** For bounded executors whose Promise settles only after their child process has exited. */
  async phase<T>(
    kind: ResourceWork,
    action: () => Promise<T>,
    scope = resourceExecution.getStore(),
    options: { wait?: boolean } = {},
  ): Promise<T> {
    if (scope?.phases?.has(kind)) {
      await scope.requireCurrent();
      return action();
    }
    // Reuse the existing worker-command ownership envelope for its nested build phase.
    if (
      kind === 'build' &&
      scope &&
      this.holdings(scope.projectId, scope.ownerId).some(
        (held) =>
          held.lease.checkpoint === 'worker-command-budget' && held.lease.state === 'granted',
      )
    ) {
      await scope.requireCurrent();
      return action();
    }
    const held = await this.acquire(kind, scope, options);
    try {
      return await resourceExecution.run(
        { ...scope!, phases: new Set([...(scope?.phases ?? []), kind]) },
        action,
      );
    } finally {
      held.release('bounded_executor_settled');
    }
  }

  stopOwner(projectId: string, ownerId: string): void {
    for (const controller of this.owners.get(JSON.stringify([projectId, ownerId])) ?? [])
      controller.abort(new Error('Stopped by owner'));
    for (const lease of this.db.admission.all())
      if (
        lease.projectId === projectId &&
        lease.ownerId === ownerId &&
        !['released', 'stopped_by_owner', 'cancelled'].includes(lease.state)
      )
        this.db.admission.stop(projectId, lease.id, lease.revision);
  }
  stopAccepting(): void {
    this.shutdown.abort(new Error('Application is closing'));
  }
  observeQuota(account: string, state: 'ok' | 'warning' | 'exhausted', resetsAt?: string): void {
    const saved = this.db.getSetting<Record<string, { exhausted: boolean; reset?: number }>>(
      'resources.accountLimits',
      {},
    );
    const reset = resetsAt ? Date.parse(resetsAt) : NaN;
    saved[account] = {
      exhausted: state === 'exhausted',
      ...(Number.isFinite(reset) ? { reset } : {}),
    };
    this.db.setSetting('resources.accountLimits', saved);
    this.manager.poke();
  }
  releaseOwner(projectId: string, ownerId: string, evidence: string): void {
    for (const lease of this.db.admission.all())
      if (
        lease.projectId === projectId &&
        lease.ownerId === ownerId &&
        ['granted', 'retained'].includes(lease.state)
      )
        this.manager.release(lease, evidence);
  }
  consumer(lease: ResourceLease, resource: ResourceRecord): string | undefined {
    const current = this.db.admission.get(lease.projectId, lease.id);
    return current &&
      ['granted', 'retained'].includes(current.state) &&
      current.locks.some(
        (lock) => lock.resourceId === resource.id && lock.generation === resource.generation,
      )
      ? `lease:${current.id}`
      : undefined;
  }
  holdings(projectId: string, ownerId: string): HeldResource[] {
    return this.db.admission
      .all()
      .filter(
        (lease) =>
          lease.projectId === projectId &&
          lease.ownerId === ownerId &&
          ['granted', 'retained'].includes(lease.state),
      )
      .map((lease) => resourceHolding(this.db, this.manager, lease));
  }
  /** Caller has just verified exit through TaskRunProcesses / NativeAdmissions for this exact key. */
  reconcileProcess(projectId: string, processKey: string): void {
    const leases = this.db.admission.all().filter((lease) => lease.projectId === projectId);
    const intents = new Set(
      leases
        .filter(
          (lease) =>
            lease.checkpoint === `process:${processKey}` &&
            ['granted', 'retained'].includes(lease.state),
        )
        .map((lease) => lease.intentId),
    );
    for (const lease of leases)
      if (intents.has(lease.intentId) && ['granted', 'retained'].includes(lease.state))
        this.manager.release(lease, 'previous_native_process_exit_confirmed');
  }
  async modelWork(
    account: string,
    needsWork: boolean,
  ): Promise<HeldResource & { work?: HeldResource }> {
    return reserveModelWork(this.db, this.dataDir, this, account, needsWork);
  }
  async close(): Promise<void> {
    this.stopAccepting();
    await this.manager.close();
  }
}
