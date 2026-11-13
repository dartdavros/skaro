import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { AppDb } from '@skaro/core';
import { coordinationHash } from '../project-coordinator-request';
export async function coordinatorHistoryAudit(db: AppDb, data: string, project: string) {
  const chats = [
    ...db.listChats(project, { includeTasks: true }),
    ...db.listChats(project, { includeTasks: true, archived: true }),
  ];
  const runs = db.listRuns(project, undefined, { includeRetired: true });
  const references = [
    ...chats.map((c) => ({ id: c.id, agent: c.agent, log: c.logPath, owner: c.taskId ?? c.id })),
    ...runs.map((r) => ({ id: r.id, agent: r.agent, log: r.logPath, owner: r.taskId })),
  ];
  const logs = [];
  for (const reference of references) {
    const path = resolve(data, reference.log);
    assert(
      ['runs', 'chats'].some((kind) => path.startsWith(resolve(data, kind, project) + sep)),
      'History must belong to the actual scoped project',
    );
    try {
      const info = await stat(path);
      logs.push({ path, bytes: info.size, hash: await prefixHash(path, info.size) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      logs.push({ path, missing: true });
    }
  }
  return {
    references,
    logs,
    nativeSettings: coordinationHash({
      chats: chats.map((c) => [c.id, db.getSetting(`chat.${c.id}.agent`, null)]),
      tasks: [...new Set(runs.map((r) => r.taskId))].map((id) => [
        id,
        db.getSetting(`task.${project}.${id}.agent`, null),
      ]),
    }),
  };
}
export async function prefixHash(path: string, size: number) {
  const hash = createHash('sha256');
  if (size)
    for await (const chunk of createReadStream(path, { start: 0, end: size - 1 }))
      hash.update(chunk);
  return hash.digest('hex');
}
export async function assertHistoryAudit(
  before: Awaited<ReturnType<typeof coordinatorHistoryAudit>>,
  db: AppDb,
  data: string,
  project: string,
) {
  const after = await coordinatorHistoryAudit(db, data, project);
  for (const reference of before.references)
    assert.deepEqual(
      after.references.find((r) => r.id === reference.id),
      reference,
    );
  assert.equal(after.nativeSettings, before.nativeSettings, 'Native permissions must not change');
  for (const log of before.logs)
    if (!log.missing)
      assert.equal(
        await prefixHash(log.path, log.bytes!),
        log.hash,
        'Historical bytes must be preserved',
      );
  return {
    references: before.references.length,
    readableHistories: before.logs.filter((l) => !l.missing).length,
    historicalPrefixesPreserved: true,
    nativeSettingsPreserved: true,
  };
}
