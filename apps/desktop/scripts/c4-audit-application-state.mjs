import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const data = join(process.env.APPDATA, 'Skaro');
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export async function hashFile(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
const readDb = (file, read) => {
  const db = new DatabaseSync(join(data, file), { readOnly: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
};
export async function backupDatabases(directory) {
  const result = [];
  for (const file of ['skaro.db', 'workspace.db']) {
    const path = join(directory, `before-${file}.sqlite`);
    readDb(file, (db) => db.prepare('VACUUM INTO ?').run(path));
    const handle = await open(path, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    const copied = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(Object.values(copied.prepare('PRAGMA integrity_check').get())[0], 'ok');
    } finally {
      copied.close();
    }
    result.push({ file, path, sha256: await hashFile(path), integrity: 'ok', synced: true });
  }
  return result;
}
export function applicationState(projectId, packageId) {
  const packages = readDb('workspace.db', (db) =>
    db
      .prepare('SELECT id,state,metadata,payload FROM records WHERE project=? ORDER BY id')
      .all(projectId)
      .map((row) => ({
        id: row.id,
        state: row.state,
        metadata: JSON.parse(row.metadata),
        payloadHash: hash(row.payload),
      })),
  );
  const primary = readDb('skaro.db', (db) => {
    const setting = (key) => {
      const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
      return row ? JSON.parse(row.value) : undefined;
    };
    const link = setting(`c4.owner-reply.${projectId}.${packageId}`);
    return {
      project: db.prepare('SELECT id,name,path FROM projects WHERE id=?').get(projectId),
      link,
      receipt: link ? setting(link.key) : undefined,
      audit: setting(`c4.audit.${projectId}`),
      chatIds: db.prepare('SELECT id FROM chats WHERE project_id=? ORDER BY id').all(projectId),
      runIds: db.prepare('SELECT id FROM runs WHERE project_id=? ORDER BY id').all(projectId),
      operations: db
        .prepare('SELECT id,state,value,evidence FROM coordination_operations WHERE project_id=?')
        .all(projectId)
        .map((row) => ({ ...row, value: JSON.parse(row.value) }))
        .filter((row) => row.value.subject.id === packageId),
      events: db
        .prepare('SELECT id,kind,data FROM events WHERE project_id=? ORDER BY id')
        .all(projectId)
        .map((row) => ({ ...row, data: JSON.parse(row.data) }))
        .filter((row) => row.data.packageId === packageId),
    };
  });
  return { packages, ...primary };
}
export function nativeAuditProcesses(projectId, auditId) {
  return readDb('skaro.db', (db) => {
    const setting = (key) => {
      const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
      return row ? JSON.parse(row.value) : undefined;
    };
    const audit = setting(`c4.audit.${projectId}`);
    assert.equal(audit?.id, auditId);
    if (!audit.chatId) return undefined;
    const chat = db.prepare('SELECT project_id,agent FROM chats WHERE id=?').get(audit.chatId);
    assert.equal(chat?.project_id, projectId);
    assert.equal(chat.agent, 'codex');
    const processes = setting(`run.chat.${audit.chatId}.processes`);
    return processes?.length ? { auditId, chatId: audit.chatId, processes } : undefined;
  });
}
export async function sourceSnapshot(root, manifest) {
  const listed = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  );
  assert.equal(listed.status, 0);
  const history = await readdir(join(root, '.skaro/c4/history')).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const paths = new Set([
    ...listed.stdout.split('\0').filter(Boolean),
    ...manifest.files.map((file) => `.skaro/${file.path}`),
    ...history.map((file) => `.skaro/c4/history/${file}`),
    `.skaro/c4/history/${manifest.revision}.json`,
    '.skaro/c4/transaction.json',
  ]);
  const result = {};
  for (const path of [...paths].sort())
    result[path] = await hashFile(join(root, path)).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  return result;
}
export async function fileTimes(root, paths) {
  return Promise.all(paths.map(async (path) => [path, (await stat(join(root, path))).mtimeMs]));
}
