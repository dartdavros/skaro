import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, statfs, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import {
  applicationState,
  backupDatabases,
  hashFile,
  sourceSnapshot,
} from './c4-audit-application-state.mjs';

const data = join(process.env.APPDATA, 'Skaro'),
  base = join(data, 'verification');
const projectId = '78bc2cd3-981b-40ed-a395-c6c6bc7da51b';
const packageId = 'skaro-c4-2fcaa711-d0aa-4225-852d-610f7afa681f';
const directory = join(base, `archiagent-ag1-${randomUUID()}`);
await mkdir(directory, { recursive: true });
const proof = { directory, projectId, packageId, checkpoints: [] };
const save = () => writeFile(join(directory, 'preflight.json'), JSON.stringify(proof, null, 2));
const free = async () => {
  const fs = await statfs(data);
  return fs.bavail * fs.bsize;
};
function compact(paths) {
  for (const path of paths) {
    const local = relative(resolve(base), resolve(path));
    assert(local && !local.startsWith('..') && !resolve(path).includes('*'));
  }
  const result = spawnSync('compact.exe', ['/C', '/I', '/Q', ...paths], {
    windowsHide: true,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
try {
  proof.freeBefore = await free();
  // These four immutable snapshots were created by the explicitly requested preceding stages.
  // Transparent compression preserves their paths, logical bytes and the original proof files.
  proof.backupCompression = [];
  const snapshots = [
    ['c43-preflight-5d11bb99-9813-43a4-943b-647f6689dd23', 'before-c43.sqlite'],
    ['c4-2-preflight-531248a9-78cd-41d2-90cd-9b6eb30fa3b8', 'before-c4-2.sqlite'],
    ['coordination-preflight-331c78db-2e59-4a99-ab9b-4f6955663745', 'before-ac5.sqlite'],
    ['rc4-preflight-373a62bf-5174-47dc-b015-c43487f1d8bf', 'before-rc4.sqlite'],
  ];
  for (const [folder, name] of snapshots) {
    const prior = JSON.parse(await readFile(join(base, folder, 'proof.json'), 'utf8'));
    assert.equal(prior.projectId, projectId);
    assert.equal(prior.backup.integrity, 'ok');
    const path = join(base, folder, name);
    assert.equal(resolve(prior.backup.path), resolve(path));
    assert.equal(await hashFile(path), prior.backup.sha256);
    const output = compact([path]);
    assert.equal(await hashFile(path), prior.backup.sha256);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(Object.values(db.prepare('PRAGMA integrity_check').get())[0], 'ok');
    } finally {
      db.close();
    }
    const handle = await open(path, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    proof.backupCompression.push({
      path,
      sha256: prior.backup.sha256,
      integrity: 'ok',
      synced: true,
      output,
    });
    await save();
  }
  proof.freeAfterCompression = await free();
  proof.directoryCompression = compact([directory]);
  proof.backups = await backupDatabases(directory);
  proof.freeAfterBackups = await free();
  proof.state = applicationState(projectId, packageId);
  assert.equal(proof.state.project.name, 'Cat-pilot');
  assert.equal(proof.state.packages.find((row) => row.id === packageId)?.state, 'applied');
  const manifest = JSON.parse(
    await readFile(
      join(base, 'c43-package-review-2fcaa711-d0aa-4225-852d-610f7afa681f/manifest.json'),
      'utf8',
    ),
  );
  proof.source = await sourceSnapshot(proof.state.project.path, manifest);
  const db = new DatabaseSync(join(data, 'skaro.db'), { readOnly: true });
  try {
    proof.runs = db.prepare('SELECT * FROM runs WHERE project_id=? ORDER BY id').all(projectId);
    proof.chats = db.prepare('SELECT * FROM chats WHERE project_id=? ORDER BY id').all(projectId);
    proof.policies = db
      .prepare('SELECT key,value FROM settings WHERE key IN (?,?,?,?,?) ORDER BY key')
      .all(
        `coordination.policy.${projectId}`,
        'resources.policy.v1',
        'resources.costs.v1',
        `coordination.dispatch.${projectId}`,
        `c4.coordination.protocol.${projectId}`,
      );
    proof.activation =
      db
        .prepare('SELECT value FROM settings WHERE key=?')
        .get(`archiagent.activation.${projectId}`) ?? null;
    proof.userVersion = Object.values(db.prepare('PRAGMA user_version').get())[0];
  } finally {
    db.close();
  }
  proof.passed = true;
} catch (error) {
  proof.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  await save();
  console.log(
    JSON.stringify({
      directory,
      passed: proof.passed,
      freeAfterBackups: proof.freeAfterBackups,
      error: proof.error,
    }),
  );
}
