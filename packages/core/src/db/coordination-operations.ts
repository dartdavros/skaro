import { isDeepStrictEqual } from 'node:util';
import type {
  CoordinationCompletion,
  CoordinationEvidence,
  CoordinationOperation,
} from '../coordination/model.ts';
import {
  coordinationEvidence,
  metadataEnum,
  metadataId,
  metadataVersion,
} from '../coordination/validation.ts';
import { coordinatorGet, operationGet, type CoordinationDb } from './coordination-records.ts';

type Outcome = { expectedRevision: number; evidence: CoordinationEvidence };
export function operationRequired(
  context: CoordinationDb,
  projectId: string,
  id: string,
): CoordinationOperation {
  const operation = operationGet(context.db, projectId, id);
  if (!operation) throw new Error('Coordination operation is not registered in this project');
  return operation;
}
function write(
  context: CoordinationDb,
  operation: CoordinationOperation,
  state: CoordinationOperation['state'],
  evidence?: CoordinationEvidence,
  claimId = operation.claimId,
): CoordinationOperation {
  const result = context.db
    .prepare(
      `UPDATE coordination_operations
    SET state=?,claim_id=?,evidence=?,revision=revision+1,updated_at=? WHERE project_id=? AND id=? AND revision=?`,
    )
    .run(
      state,
      claimId ?? null,
      evidence ? JSON.stringify(evidence) : null,
      context.now(),
      operation.projectId,
      operation.id,
      operation.revision,
    );
  if (result.changes !== 1) throw new Error('Coordination operation revision changed');
  return operationRequired(context, operation.projectId, operation.id);
}
function revision(operation: CoordinationOperation, expected: number): void {
  metadataVersion(expected, 1);
  if (operation.revision !== expected) throw new Error('Coordination operation revision changed');
}
export function claimOperation(
  context: CoordinationDb,
  projectId: string,
  id: string,
  input: { expectedRevision: number; claimId: string },
): { operation: CoordinationOperation; acquired: boolean } {
  metadataVersion(input.expectedRevision, 1);
  metadataId(input.claimId);
  const operation = operationRequired(context, projectId, id);
  if (operation.state !== 'queued') return { operation, acquired: false };
  revision(operation, input.expectedRevision);
  const coordinator = coordinatorGet(context.db, projectId)!;
  if (
    operation.expectedVersion !== undefined &&
    coordinator.version !== operation.expectedVersion
  ) {
    return {
      operation: write(context, operation, 'rejected', {
        code: 'stale_project_version',
        refs: [operation.subject],
      }),
      acquired: false,
    };
  }
  const busy = context.db
    .prepare(
      `SELECT id FROM coordination_operations WHERE project_id=? AND scope_key=?
    AND state IN ('dispatching','uncertain') LIMIT 1`,
    )
    .get(projectId, operation.scopeKey);
  if (busy) return { operation, acquired: false };
  if (operation.mode === 'mutation') {
    const updated = context.db
      .prepare(
        `UPDATE project_coordinators SET version=version+1,updated_at=?
      WHERE project_id=? AND version=?`,
      )
      .run(context.now(), projectId, coordinator.version);
    if (updated.changes !== 1) throw new Error('Coordinator project version changed');
  }
  return {
    operation: write(context, operation, 'dispatching', undefined, input.claimId),
    acquired: true,
  };
}
export function finishOperation(
  context: CoordinationDb,
  projectId: string,
  id: string,
  input: CoordinationCompletion,
): CoordinationOperation {
  metadataId(input.claimId);
  metadataVersion(input.expectedRevision, 1);
  const state = metadataEnum(input.state, ['succeeded', 'failed', 'uncertain'] as const);
  const evidence = coordinationEvidence(input.evidence);
  const operation = operationRequired(context, projectId, id);
  if (operation.claimId !== input.claimId)
    throw new Error('Coordination dispatch identity changed');
  if (operation.state === state && isDeepStrictEqual(operation.evidence, evidence))
    return operation;
  revision(operation, input.expectedRevision);
  if (operation.state !== 'dispatching')
    throw new Error('Only a dispatching operation can record a delivery outcome');
  return write(context, operation, state, evidence);
}
export function rejectOperation(
  context: CoordinationDb,
  projectId: string,
  id: string,
  input: Outcome,
): CoordinationOperation {
  const evidence = coordinationEvidence(input.evidence);
  const operation = operationRequired(context, projectId, id);
  if (operation.state === 'rejected' && isDeepStrictEqual(operation.evidence, evidence))
    return operation;
  revision(operation, input.expectedRevision);
  if (operation.state !== 'queued') throw new Error('Only a queued operation can be rejected');
  return write(context, operation, 'rejected', evidence);
}
export function reconcileOperation(
  context: CoordinationDb,
  projectId: string,
  id: string,
  input: Outcome & { state: 'succeeded' | 'failed' },
): CoordinationOperation {
  const state = metadataEnum(input.state, ['succeeded', 'failed'] as const);
  const evidence = coordinationEvidence(input.evidence);
  const operation = operationRequired(context, projectId, id);
  if (operation.state === state && isDeepStrictEqual(operation.evidence, evidence))
    return operation;
  revision(operation, input.expectedRevision);
  if (operation.state !== 'uncertain')
    throw new Error('Only an uncertain operation can be reconciled');
  return write(context, operation, state, evidence);
}
/** Called once by the singleton host during recovery, never by a timer or an expired lease. */
export function recoverOperations(
  context: CoordinationDb,
  projectId: string,
): CoordinationOperation[] {
  metadataId(projectId);
  const rows = context.db
    .prepare(
      `SELECT id FROM coordination_operations WHERE project_id=? AND state='dispatching' ORDER BY created_at,rowid`,
    )
    .all(projectId);
  return rows.map((row) => {
    const operation = operationRequired(context, projectId, String(row.id));
    return write(context, operation, 'uncertain', {
      code: 'dispatch_interrupted',
      refs: [operation.subject],
    });
  });
}
