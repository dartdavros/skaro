import { resourceId, type AppDb, type ResourceRegistration } from '@skaro/core';
import { resolve } from 'node:path';

/** OS editors expose no verified close signal. A durable generation-bound pin is intentional. */
export function pinWorktreeAccess(db: AppDb, projectId: string, path: string): void {
  const input: ResourceRegistration = {
    projectId,
    kind: 'worktree',
    identity: { path: resolve(path) },
    owner: { kind: 'unknown', id: resolve(path) },
    purpose: 'unknown',
    ownership: 'legacy-unverified',
    preservation: 'unknown',
    generation: 1,
    consumers: [],
    state: 'retained',
  };
  let record = db.resources.get(resourceId(input)) ?? db.resources.register(input);
  if (record.state === 'released') throw new Error('Cannot open a released worktree generation');
  const id = `explicit-access:${record.id}:${record.generation}`;
  if (!record.consumers.some((consumer) => consumer.id === id))
    record = db.resources.update(record.id, record.revision, {
      consumers: [...record.consumers, { id, kind: 'preview', generation: record.generation }],
    });
  if (
    record.lastOutcome?.generation !== record.generation ||
    record.lastOutcome.reason !== 'external_worktree_consumer_unverified'
  )
    db.resources.recordOutcome({
      operationId: id,
      resourceId: record.id,
      generation: record.generation,
      action: 'inspect',
      state: 'retained',
      reason: 'external_worktree_consumer_unverified',
    });
  // No TTL and no release on shell.openPath resolution, exception or application restart.
}
