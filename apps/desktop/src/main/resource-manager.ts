import type { AppDb, ResourceLease, ResourceLeaseRequest } from '@skaro/core';
import { resourceWait } from './resource-wait';

export interface ResourceAdmissionOptions {
  signal: AbortSignal;
  /** false returns a conflict without waiting; default waits only for ownership locks. */
  wait?: boolean;
  /** Re-read intent, current requirements and readiness; never use a stale boolean snapshot. */
  requireCurrent(): void | Promise<void>;
  changed?(): void;
}
export class ResourceAdmissionUnavailable extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super('resource_admission_unavailable');
    this.reason = reason;
  }
}
interface Pending {
  request: ResourceLeaseRequest;
  options: ResourceAdmissionOptions;
  resolve(lease: ResourceLease): void;
  reject(error: unknown): void;
  cancelled(): void;
}

/** Application-scoped owner dispatcher. Measurements never participate in dispatch. */
export class ResourceManager {
  private readonly db: AppDb;
  private readonly publish: (lease: ResourceLease) => void;
  private readonly pending = new Map<string, Pending>();
  private pumping?: Promise<void>;
  private repump = false;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  constructor(db: AppDb, changed: (lease: ResourceLease) => void) {
    this.db = db;
    this.publish = changed;
  }

  private changed(lease: ResourceLease): void {
    try {
      this.publish(lease);
    } catch (error) {
      console.error('Resource admission notification failed:', error);
    }
  }

  acquire(
    request: ResourceLeaseRequest,
    options: ResourceAdmissionOptions,
  ): Promise<ResourceLease> {
    options.signal.throwIfAborted();
    if (this.closed) return Promise.reject(new Error('Resource admission is closing'));
    if (
      !this.db.getProject(request.projectId) ||
      (this.db.shell.projectScope && request.projectId !== this.db.shell.projectScope)
    )
      throw new Error('Resource request is outside the registered project scope');
    const lease = this.db.admission.request(request);
    // Sharing an active grant is not another authorization to start its external effect.
    if (!['waiting_resource', 'waiting_quota'].includes(lease.state))
      return Promise.reject(new Error(`Resource request cannot be redispatched: ${lease.state}`));
    if (this.pending.has(request.id))
      return Promise.reject(new Error('Resource request already queued'));
    const promise = new Promise<ResourceLease>((resolve, reject) => {
      const cancelled = () => {
        const current = this.db.admission.get(request.projectId, request.id)!;
        this.changed(this.db.admission.stop(request.projectId, request.id, current.revision));
        this.finish(request.id, options.signal.reason ?? new Error('Resource admission cancelled'));
      };
      this.pending.set(request.id, { request, options, resolve, reject, cancelled });
      options.signal.addEventListener('abort', cancelled, { once: true });
      if (options.signal.aborted) cancelled();
    });
    this.poke();
    return promise;
  }
  poke(): void {
    if (this.closed) return;
    if (this.pumping) {
      this.repump = true;
      return;
    }
    clearTimeout(this.timer);
    this.pumping = this.pump().finally(() => {
      this.pumping = undefined;
      const immediate = this.repump;
      this.repump = false;
      if (!this.closed && immediate) this.poke();
      else if (!this.closed && this.pending.size) {
        this.timer = setTimeout(() => this.poke(), 2000);
        this.timer.unref();
      }
    });
    void this.pumping.catch((error: unknown) => {
      console.error('Resource ownership dispatch failed:', error);
    });
  }
  private async pump(): Promise<void> {
    const ordered = this.db.admission.all().filter((lease) => this.pending.has(lease.id));
    for (const saved of ordered) {
      const pending = this.pending.get(saved.id);
      if (!pending || this.closed) continue;
      try {
        pending.options.signal.throwIfAborted();
        await pending.options.requireCurrent();
        pending.options.signal.throwIfAborted();
        if (this.closed || !this.pending.has(saved.id)) continue;
        const current = this.db.admission.get(saved.projectId, saved.id)!;
        const lease = this.db.admission.admit(saved.projectId, saved.id, current.revision);
        if (lease.state !== current.state || lease.reason !== current.reason) this.changed(lease);
        try {
          pending.options.changed?.();
        } catch (error) {
          console.error('Resource wait notification failed:', error);
        }
        if (lease.state === 'granted') this.finish(saved.id, undefined, lease);
        else if (
          pending.options.wait === false &&
          ['waiting_resource', 'waiting_quota'].includes(lease.state)
        ) {
          const reason = lease.reason ?? 'resource_locked';
          this.changed(this.db.admission.cancel(saved.projectId, saved.id, lease.revision, reason));
          this.finish(saved.id, new ResourceAdmissionUnavailable(reason));
        } else if (!['waiting_resource', 'waiting_quota'].includes(lease.state))
          this.finish(saved.id, new Error(`Resource admission stopped: ${lease.state}`));
      } catch (error) {
        const current = this.db.admission.get(saved.projectId, saved.id)!;
        if (['waiting_resource', 'waiting_quota'].includes(current.state))
          this.changed(this.db.admission.stop(saved.projectId, saved.id, current.revision));
        this.finish(saved.id, error);
      }
    }
  }
  private finish(id: string, error?: unknown, lease?: ResourceLease): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    pending.options.signal.removeEventListener('abort', pending.cancelled);
    if (lease) pending.resolve(lease);
    else pending.reject(error);
  }
  /** Only this process's live waiters count; restart history cannot invent active work. */
  waiting(projectId: string, ownerId: string) {
    const pending = [...this.pending.values()].find(
      ({ request }) => request.projectId === projectId && request.ownerId === ownerId,
    );
    if (!pending) return undefined;
    const lease = this.db.admission.get(projectId, pending.request.id);
    return lease && ['waiting_resource', 'waiting_quota'].includes(lease.state)
      ? resourceWait(lease)
      : undefined;
  }
  /** Caller supplies confirmed external teardown, not just Promise completion or a TTL. */
  release(lease: ResourceLease, evidence: string): void {
    this.changed(
      this.db.admission.release(
        lease.projectId,
        lease.id,
        lease.revision,
        Object.fromEntries(lease.locks.map((lock) => [lock.resourceId, lock.generation])),
        evidence,
      ),
    );
    this.poke();
  }
  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.timer);
    try {
      await this.pumping;
    } finally {
      for (const [id] of this.pending)
        this.finish(id, new Error('Resource admission closed before dispatch'));
    }
  }
}
