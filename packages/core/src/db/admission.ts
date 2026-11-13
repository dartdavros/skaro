import { rememberLiveResourceGrant, isLiveResourceGrant } from './resource-live-grant.ts';
import { isDeepStrictEqual } from 'node:util';
import { DbTable } from './table.ts';
import { DbResources } from './resources.ts';
import { resourceLeaseConsumers } from './admission-consumers.ts';
import { resourceLeaseRecords } from './admission-records.ts';
import { splitResourceReservation } from './admission-split.ts';
import {
  ownsResourceCapacity,
  type ResourceBudget,
  type ResourceLease,
  type ResourceLeaseRequest,
} from '../resources/admission-model.ts';
import { resourceAdmissionReason, validateResourceRequest } from '../resources/admission-policy.ts';

/** One application-wide ledger, including uncertain holdings. No TTL releases external resources. */
export class DbResourceAdmission extends DbTable {
  cancel(project: string, id: string, revision: number, reason: string): ResourceLease {
    return this.atomic(() => {
      const lease = this.required(project, id, revision);
      if (!['waiting_resource', 'waiting_quota'].includes(lease.state)) return lease;
      return this.write(lease, 'cancelled', reason);
    });
  }
  split(
    project: string,
    id: string,
    revision: number,
    parts: Parameters<typeof splitResourceReservation>[3],
  ): ResourceLease[] {
    return this.atomic(() =>
      splitResourceReservation(this.db, this.now(), this.required(project, id, revision), parts),
    );
  }
  private atomic<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  all(): ResourceLease[] {
    return resourceLeaseRecords(this.db);
  }
  get(projectId: string, id: string): ResourceLease | undefined {
    return this.all().find((lease) => lease.id === id && lease.projectId === projectId);
  }
  isLive(lease: ResourceLease): boolean {
    return (
      isLiveResourceGrant(this.db, lease) &&
      isDeepStrictEqual(this.get(lease.projectId, lease.id), lease)
    );
  }
  request(input: ResourceLeaseRequest): ResourceLease {
    validateResourceRequest(input);
    return this.atomic(() => {
      const found = this.all().find((lease) => lease.id === input.id);
      if (found) {
        const {
          revision: _r,
          sequence: _s,
          state: _t,
          reason: _why,
          createdAt: _c,
          updatedAt: _u,
          evidence: _e,
          ...saved
        } = found;
        if (!isDeepStrictEqual(saved, input))
          throw new Error('Resource request ID belongs to different inputs');
        return found;
      }
      const now = this.now();
      const lease = {
        ...structuredClone(input),
        revision: 1,
        state: 'waiting_resource',
        reason: 'queued',
        createdAt: now,
        updatedAt: now,
      };
      this.db
        .prepare('INSERT INTO resource_leases(id,project_id,value) VALUES(?,?,?)')
        .run(input.id, input.projectId, JSON.stringify(lease));
      return this.get(input.projectId, input.id)!;
    });
  }
  private required(project: string, id: string, revision: number): ResourceLease {
    const lease = this.get(project, id);
    if (!lease || lease.revision !== revision)
      throw new Error('Resource lease revision or project changed');
    return lease;
  }
  private write(
    lease: ResourceLease,
    state: ResourceLease['state'],
    reason: string,
    evidence?: string,
  ): ResourceLease {
    if (lease.state === state && lease.reason === reason && evidence === undefined) return lease;
    const next: ResourceLease = {
      ...lease,
      state,
      reason,
      revision: lease.revision + 1,
      updatedAt: this.now(),
      ...(evidence ? { evidence } : {}),
    };
    this.db
      .prepare('UPDATE resource_leases SET value=? WHERE id=? AND project_id=?')
      .run(JSON.stringify(next), lease.id, lease.projectId);
    return rememberLiveResourceGrant(this.db, next);
  }
  admit(project: string, id: string, revision: number, budget: ResourceBudget): ResourceLease {
    return this.atomic(() => {
      const lease = this.required(project, id, revision);
      const resources = new DbResources(this.db, this.now);
      if (
        lease.locks.some((lock) => {
          const resource = resources.get(lock.resourceId);
          return (
            resources.cleanup.read(lock.resourceId) ||
            (resource && resources.cleanup.blocking(resource))
          );
        })
      ) {
        if (!['waiting_resource', 'waiting_quota'].includes(lease.state))
          throw new Error('Resource cleanup excludes dispatch of the existing lease');
        return this.write(lease, 'waiting_resource', 'resource_cleanup_locked');
      }
      if (!['waiting_resource', 'waiting_quota'].includes(lease.state)) return lease;
      for (const lock of lease.locks) {
        const resource = resources.get(lock.resourceId);
        if (
          !resource ||
          resource.projectId !== project ||
          resource.generation !== lock.generation ||
          resource.state === 'released'
        )
          return this.write(lease, 'waiting_resource', 'resource_generation_changed');
      }
      const reason = resourceAdmissionReason(lease, this.all(), budget, this.now());
      const result = this.write(
        lease,
        reason ? (reason.startsWith('account_') ? 'waiting_quota' : 'waiting_resource') : 'granted',
        reason ?? 'admitted',
      );
      if (!reason)
        for (const lock of lease.locks) {
          const resource = resources.get(lock.resourceId)!;
          const leases = resourceLeaseConsumers(this.db, resource.id);
          resources.update(resource.id, resource.revision, {
            consumers: [
              ...resource.consumers.filter(
                (consumer) => !leases.some((held) => held.id === consumer.id),
              ),
              ...leases,
            ],
          });
        }
      return result;
    });
  }
  stop(project: string, id: string, revision: number): ResourceLease {
    return this.atomic(() => {
      const lease = this.required(project, id, revision);
      if (['released', 'stopped_by_owner', 'cancelled'].includes(lease.state)) return lease;
      return this.write(
        lease,
        ownsResourceCapacity(lease) ? 'retained' : 'stopped_by_owner',
        'stopped_by_owner',
      );
    });
  }
  release(
    project: string,
    id: string,
    revision: number,
    generations: Record<string, number>,
    evidence: string,
  ): ResourceLease {
    return this.atomic(() => {
      const lease = this.required(project, id, revision);
      if (
        !evidence.trim() ||
        !ownsResourceCapacity(lease) ||
        lease.locks.some((lock) => generations[lock.resourceId] !== lock.generation)
      )
        throw new Error('Resource release requires current generation and confirmed teardown');
      const result = this.write(
        lease,
        lease.reason === 'stopped_by_owner' ? 'stopped_by_owner' : 'released',
        'teardown_confirmed',
        evidence,
      );
      const resources = new DbResources(this.db, this.now);
      for (const lock of lease.locks) {
        const resource = resources.get(lock.resourceId);
        if (!resource || resource.generation !== lock.generation)
          throw new Error('Resource generation changed before release');
        resources.update(resource.id, resource.revision, {
          consumers: resource.consumers.filter((consumer) => consumer.id !== `lease:${lease.id}`),
        });
      }
      return result;
    });
  }
  retain(project: string, id: string, revision: number): ResourceLease {
    return this.atomic(() => {
      const lease = this.required(project, id, revision);
      if (lease.state !== 'granted') return lease;
      return this.write(lease, 'retained', 'external_state_requires_reconciliation');
    });
  }

  /** Bind a capacity reservation to the resource generation created by its admitted executor. */
  bind(
    project: string,
    id: string,
    revision: number,
    locks: ResourceLeaseRequest['locks'],
  ): ResourceLease {
    return this.atomic(() => {
      const lease = this.required(project, id, revision);
      validateResourceRequest({ ...lease, locks });
      if (!ownsResourceCapacity(lease))
        throw new Error('Only a held reservation can bind a resource');
      if (
        locks.some((lock) => {
          const ledger = new DbResources(this.db, this.now);
          const resource = ledger.get(lock.resourceId);
          return (
            ledger.cleanup.read(lock.resourceId) || (resource && ledger.cleanup.blocking(resource))
          );
        })
      )
        throw new Error('Resource cleanup excludes binding new consumers');
      if (isDeepStrictEqual(lease.locks, locks)) return lease;
      // A newly created resource may be appended; existing bindings must keep their order,
      // generation and mode. Replacing/dropping an already bound resource is never renewal.
      if (lease.locks.some((lock, index) => !isDeepStrictEqual(lock, locks[index])))
        throw new Error('A bound generation cannot be replaced');
      const resources = new DbResources(this.db, this.now);
      for (const lock of locks) {
        const resource = resources.get(lock.resourceId);
        if (
          !resource ||
          resource.projectId !== project ||
          resource.generation !== lock.generation ||
          resource.state === 'released'
        )
          throw new Error('Resource generation changed before binding');
        if (
          this.all().some(
            (other) =>
              other.id !== id &&
              ownsResourceCapacity(other) &&
              other.locks.some(
                (held) =>
                  held.resourceId === lock.resourceId &&
                  (held.generation !== lock.generation ||
                    held.mode === 'exclusive' ||
                    lock.mode === 'exclusive'),
              ),
          )
        )
          throw new Error('Resource acquired another incompatible consumer');
      }
      const next = {
        ...lease,
        locks: structuredClone(locks),
        revision: lease.revision + 1,
        updatedAt: this.now(),
      };
      this.db
        .prepare('UPDATE resource_leases SET value=? WHERE id=? AND project_id=?')
        .run(JSON.stringify(next), id, project);
      for (const lock of locks) {
        const resource = resources.get(lock.resourceId)!;
        const consumers = resourceLeaseConsumers(this.db, resource.id);
        resources.update(resource.id, resource.revision, {
          consumers: [
            ...resource.consumers.filter((c) => !consumers.some((held) => held.id === c.id)),
            ...consumers,
          ],
        });
      }
      return rememberLiveResourceGrant(this.db, next);
    });
  }
}
