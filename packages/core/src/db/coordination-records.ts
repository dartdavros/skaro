import { isDeepStrictEqual } from 'node:util';
import type { DatabaseSync } from 'node:sqlite';
import type {
  CoordinationEvent,
  CoordinationIntent,
  CoordinationOperation,
  CoordinationRequest,
  ProjectCoordinator,
} from '../coordination/model.ts';
import {
  coordinationEvidence,
  coordinationEvent,
  coordinationIntent,
  coordinationRequest,
  metadataEnum,
  metadataId,
  metadataVersion,
} from '../coordination/validation.ts';

export type CoordinationDb = { db: DatabaseSync; now: () => number };
export function coordinationAtomic<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export function coordinatorGet(
  db: DatabaseSync,
  projectId: string,
): ProjectCoordinator | undefined {
  metadataId(projectId);
  if (
    !db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_coordinators'")
      .get()
  )
    return undefined;
  const row = db.prepare('SELECT * FROM project_coordinators WHERE project_id=?').get(projectId);
  if (!row) return undefined;
  if (row.id !== `coordinator:${projectId}`)
    throw new Error('Stored coordinator identity is inconsistent');
  return {
    id: String(row.id),
    projectId,
    version: metadataVersion(row.version),
    createdAt: metadataVersion(row.created_at),
    updatedAt: metadataVersion(row.updated_at),
  };
}
export function coordinatorEnsure(
  db: DatabaseSync,
  now: number,
  projectId: string,
): ProjectCoordinator {
  metadataId(projectId);
  db.prepare(
    `INSERT INTO project_coordinators(project_id,id,version,created_at,updated_at)
    VALUES (?,?,0,?,?) ON CONFLICT(project_id) DO NOTHING`,
  ).run(projectId, `coordinator:${projectId}`, now, now);
  return coordinatorGet(db, projectId)!;
}
export function causalGet(
  db: DatabaseSync,
  kind: 'events',
  projectId: string,
  id: string,
): CoordinationEvent | undefined;
export function causalGet(
  db: DatabaseSync,
  kind: 'intents',
  projectId: string,
  id: string,
): CoordinationIntent | undefined;
export function causalGet(
  db: DatabaseSync,
  kind: 'events' | 'intents',
  projectId: string,
  id: string,
): CoordinationEvent | CoordinationIntent | undefined {
  metadataId(projectId);
  metadataId(id);
  if (!coordinatorGet(db, projectId)) return undefined;
  const row = db
    .prepare(`SELECT value,created_at FROM coordination_${kind} WHERE project_id=? AND id=?`)
    .get(projectId, id);
  if (!row) return undefined;
  const raw = JSON.parse(String(row.value)) as unknown;
  const value = kind === 'events' ? coordinationEvent(raw) : coordinationIntent(raw);
  if (value.id !== id || value.projectId !== projectId)
    throw new Error('Stored coordination scope is inconsistent');
  return { ...value, createdAt: metadataVersion(row.created_at) };
}
export function operationGet(
  db: DatabaseSync,
  projectId: string,
  id: string,
): CoordinationOperation | undefined {
  metadataId(projectId);
  metadataId(id);
  if (!coordinatorGet(db, projectId)) return undefined;
  const row = db
    .prepare('SELECT * FROM coordination_operations WHERE project_id=? AND id=?')
    .get(projectId, id);
  if (!row) return undefined;
  const raw = JSON.parse(String(row.value)) as CoordinationRequest['operation'];
  const event = causalGet(db, 'events', projectId, raw.eventId);
  const intent = causalGet(db, 'intents', projectId, raw.intentId);
  if (!event || !intent) throw new Error('Stored coordination causal records are missing');
  const { createdAt: _eventAt, ...eventInput } = event;
  const { createdAt: _intentAt, ...intentInput } = intent;
  const { operation } = coordinationRequest({
    event: eventInput,
    intent: intentInput,
    operation: raw,
  });
  if (
    operation.id !== id ||
    operation.projectId !== projectId ||
    operation.scopeKey !== row.scope_key ||
    operation.idempotencyKey !== row.idempotency_key ||
    operation.eventId !== row.event_id ||
    operation.intentId !== row.intent_id
  )
    throw new Error('Stored coordination operation identity is inconsistent');
  const state = metadataEnum(row.state, [
    'queued',
    'dispatching',
    'succeeded',
    'failed',
    'uncertain',
    'rejected',
  ] as const);
  const claimId = row.claim_id === null ? undefined : metadataId(row.claim_id);
  const evidence =
    row.evidence === null ? undefined : coordinationEvidence(JSON.parse(String(row.evidence)));
  if (['dispatching', 'uncertain', 'succeeded', 'failed'].includes(state) && !claimId)
    throw new Error('Stored operation has no dispatch identity');
  if ((state === 'queued' || state === 'rejected') && claimId)
    throw new Error('Stored operation has an unexpected dispatch identity');
  if ((state === 'queued' || state === 'dispatching') && evidence)
    throw new Error('Stored operation has a premature outcome');
  if (['succeeded', 'failed', 'uncertain', 'rejected'].includes(state) && !evidence)
    throw new Error('Stored operation outcome has no evidence');
  return {
    ...operation,
    state,
    ...(claimId ? { claimId } : {}),
    ...(evidence ? { evidence } : {}),
    revision: metadataVersion(row.revision, 1),
    createdAt: metadataVersion(row.created_at),
    updatedAt: metadataVersion(row.updated_at),
  };
}
export function acceptRequest({ db, now }: CoordinationDb, input: unknown): CoordinationOperation {
  const request = coordinationRequest(input);
  const { event, intent, operation } = request;
  const at = now();
  coordinatorEnsure(db, at, operation.projectId);
  for (const [kind, value] of [
    ['events', event],
    ['intents', intent],
  ] as const) {
    db.prepare(
      `INSERT INTO coordination_${kind}(project_id,id,value,created_at) VALUES (?,?,?,?)
      ON CONFLICT(project_id,id) DO NOTHING`,
    ).run(value.projectId, value.id, JSON.stringify(value), at);
    const old = db
      .prepare(`SELECT value FROM coordination_${kind} WHERE project_id=? AND id=?`)
      .get(value.projectId, value.id)!;
    if (!isDeepStrictEqual(JSON.parse(String(old.value)), value))
      throw new Error('Coordination causal identity already belongs to another request');
  }
  db.prepare(
    `INSERT INTO coordination_operations(project_id,id,idempotency_key,event_id,intent_id,scope_key,value,revision,state,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,1,'queued',?,?) ON CONFLICT DO NOTHING`,
  ).run(
    operation.projectId,
    operation.id,
    operation.idempotencyKey,
    operation.eventId,
    operation.intentId,
    operation.scopeKey,
    JSON.stringify(operation),
    at,
    at,
  );
  const saved = db
    .prepare('SELECT value FROM coordination_operations WHERE project_id=? AND id=?')
    .get(operation.projectId, operation.id);
  if (!saved || !isDeepStrictEqual(JSON.parse(String(saved.value)), operation))
    throw new Error('Coordination operation identity already belongs to another request');
  return operationGet(db, operation.projectId, operation.id)!;
}
