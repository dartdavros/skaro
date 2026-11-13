import { join } from 'node:path';
import type { AppDb, ResourceRecord } from '@skaro/core';
import type { HistoryEntry } from './history-file-metadata';
import { exportInfo, historyDirectory, removeExport } from './history-file-storage';
import { historyOutcome } from './history-file-records';
import { HistoryPathGuard } from './history-path-guard';

export const historyEvictionOperation = (record: ResourceRecord) =>
  `cache.remove:${record.id}:${record.generation}`;

/** Durable generation exclusion covers filesystem effects, verified release, inventory and outcomes. */
export async function evictHistoryExport(
  db: AppDb,
  dataDir: string,
  project: string,
  entry: HistoryEntry,
  record: ResourceRecord,
  published: () => void,
): Promise<void> {
  if (
    record.ownership !== 'registered' ||
    record.preservation !== 'reproducible' ||
    record.kind !== 'cache' ||
    record.purpose !== 'cache' ||
    record.projectId !== project ||
    record.generation !== entry.generation ||
    record.source?.recovery !== 'git-blob-export-v2' ||
    record.source.dataVersion !== entry.digest ||
    record.source.commit !== entry.commit ||
    record.source.declarationRevision !== entry.identity ||
    ['legacy', 'retained'].includes(entry.phase)
  )
    throw new Error('Historical export cleanup ownership is unverified');
  const operation = historyEvictionOperation(record);
  await db.resources.cleanup.run(record, operation, async () => {
    const dir = await historyDirectory(dataDir, project),
      path = join(dir, entry.name);
    if (record.identity.path !== path) throw new Error('Historical export cleanup path changed');
    const scope = await HistoryPathGuard.capture(dir);
    const effect = () => db.resources.cleanup.effect(record.id);
    const bytes = await removeExport(path, entry, effect, scope);
    if (entry.pending) await removeExport(join(dir, entry.pending), entry, effect, scope);
    if (
      (await exportInfo(path, entry)).state !== 'missing' ||
      (entry.pending && (await exportInfo(join(dir, entry.pending), entry)).state !== 'missing')
    )
      throw new Error('Historical export removal is not verified');
    await scope.directory(dir);
    const current = db.resources.get(record.id);
    if (!current || current.generation !== record.generation || current.consumers.length)
      throw new Error('Historical export cleanup generation changed');
    const released = db.resources.update(current.id, current.revision, { state: 'released' });
    published();
    historyOutcome(db, released, 'released', 'export_evicted', bytes);
  });
}
