import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  resourceId,
  type AppDb,
  type ResourceRecord,
  type ResourceRegistration,
} from '@skaro/core';
import type { HistoryEntry } from './history-file-metadata';

export function historyResource(
  db: AppDb,
  project: string,
  dir: string,
  entry: HistoryEntry,
): ResourceRecord {
  const legacy = entry.phase === 'legacy';
  const input: ResourceRegistration = {
    projectId: project,
    kind: 'cache',
    identity: { path: join(dir, entry.name) },
    owner: { kind: 'project', id: project },
    purpose: 'cache',
    ownership: legacy ? 'legacy-unverified' : 'registered',
    preservation: legacy ? 'unknown' : 'reproducible',
    generation: entry.generation,
    consumers: legacy
      ? [
          {
            id: `history-legacy-unknown:${entry.name}`,
            kind: 'unknown',
            generation: entry.generation,
          },
        ]
      : [],
    state: 'retained',
    source: {
      ...(entry.commit ? { commit: entry.commit } : {}),
      dataVersion: entry.digest,
      declarationRevision: entry.identity,
      recovery: 'git-blob-export-v2',
    },
  };
  const old = db.resources.get(resourceId(input));
  if (!old) return db.resources.register(input);
  if (
    old.generation !== entry.generation ||
    old.purpose !== 'cache' ||
    old.owner.kind !== 'project' ||
    old.owner.id !== project ||
    old.ownership !== input.ownership ||
    old.preservation !== input.preservation ||
    old.source?.dataVersion !== entry.digest ||
    old.source.declarationRevision !== entry.identity ||
    old.source.commit !== entry.commit ||
    old.source.recovery !== 'git-blob-export-v2'
  )
    throw new Error('Historical export resource identity is inconsistent');
  return old;
}

export function pinHistoryExport(db: AppDb, record: ResourceRecord): ResourceRecord {
  if (record.state === 'released') throw new Error('Historical export generation was released');
  const id = `external-history:${record.id}:${record.generation}`;
  if (record.consumers.some((consumer) => consumer.id === id)) return record;
  return db.resources.update(record.id, record.revision, {
    state: 'retained',
    consumers: [...record.consumers, { id, kind: 'preview', generation: record.generation }],
  });
}

/** Durable object-specific ledger/events only. Visible representation remains the AC-4 design gate. */
export function historyOutcome(
  db: AppDb,
  record: ResourceRecord,
  state: 'retained' | 'failed' | 'released' | 'observed',
  reason: string,
  freedBytes?: number,
) {
  const old = db.resources.get(record.id)?.lastOutcome;
  if (old?.generation === record.generation && old.state === state && old.reason === reason) return;
  db.resources.recordOutcome({
    operationId: randomUUID(),
    resourceId: record.id,
    generation: record.generation,
    action: state === 'released' ? 'remove' : 'inspect',
    state,
    reason,
    freedBytes,
  });
  db.addEvent(
    record.projectId,
    `resource_cache_${state === 'released' ? 'released' : 'retained'}`,
    {
      kind: 'history',
      resourceId: record.id,
      generation: record.generation,
      reason,
      ...(freedBytes !== undefined ? { bytes: freedBytes } : {}),
    },
  );
}
