import type { DatabaseSync } from 'node:sqlite';
import type {
  CoordinationCompletion,
  CoordinationEvidence,
  CoordinationRequest,
} from '../coordination/model.ts';
import { metadataId } from '../coordination/validation.ts';
import { DbCoordinationEntities } from './coordination-entities.ts';
import {
  claimOperation,
  finishOperation,
  reconcileOperation,
  recoverOperations,
  rejectOperation,
} from './coordination-operations.ts';
import {
  acceptRequest,
  causalGet,
  coordinationAtomic,
  coordinatorEnsure,
  coordinatorGet,
  operationGet,
} from './coordination-records.ts';

/** Durable dispatch fencing, without holding a database transaction across a handler/agent turn. */
export class DbCoordination {
  readonly decisions: DbCoordinationEntities<'decision'>;
  readonly blockers: DbCoordinationEntities<'blocker'>;
  private readonly context;
  constructor(db: DatabaseSync, now: () => number) {
    this.context = { db, now };
    this.decisions = new DbCoordinationEntities(this.context, 'decision');
    this.blockers = new DbCoordinationEntities(this.context, 'blocker');
  }
  ensure(projectId: string) {
    return coordinatorEnsure(this.context.db, this.context.now(), projectId);
  }
  get(projectId: string) {
    return coordinatorGet(this.context.db, projectId);
  }
  accept(input: CoordinationRequest) {
    return coordinationAtomic(this.context.db, () => acceptRequest(this.context, input));
  }
  getOperation(projectId: string, id: string) {
    return operationGet(this.context.db, projectId, id);
  }
  getEvent(projectId: string, id: string) {
    return causalGet(this.context.db, 'events', projectId, id);
  }
  getIntent(projectId: string, id: string) {
    return causalGet(this.context.db, 'intents', projectId, id);
  }
  pending(projectId: string) {
    metadataId(projectId);
    if (!this.get(projectId)) return [];
    return this.context.db
      .prepare(
        `SELECT id FROM coordination_operations WHERE project_id=?
      AND state IN ('queued','dispatching','uncertain') ORDER BY created_at,rowid`,
      )
      .all(projectId)
      .map((row) => this.getOperation(projectId, String(row.id))!);
  }
  claim(projectId: string, id: string, input: { expectedRevision: number; claimId: string }) {
    return coordinationAtomic(this.context.db, () =>
      claimOperation(this.context, projectId, id, input),
    );
  }
  finish(projectId: string, id: string, input: CoordinationCompletion) {
    return coordinationAtomic(this.context.db, () =>
      finishOperation(this.context, projectId, id, input),
    );
  }
  reject(
    projectId: string,
    id: string,
    input: { expectedRevision: number; evidence: CoordinationEvidence },
  ) {
    return coordinationAtomic(this.context.db, () =>
      rejectOperation(this.context, projectId, id, input),
    );
  }
  recover(projectId: string) {
    return coordinationAtomic(this.context.db, () => recoverOperations(this.context, projectId));
  }
  reconcile(
    projectId: string,
    id: string,
    input: {
      expectedRevision: number;
      state: 'succeeded' | 'failed';
      evidence: CoordinationEvidence;
    },
  ) {
    return coordinationAtomic(this.context.db, () =>
      reconcileOperation(this.context, projectId, id, input),
    );
  }
}
