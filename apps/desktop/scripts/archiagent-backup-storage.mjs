import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { open, readFile, statfs, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { hashFile } from './c4-audit-application-state.mjs';

const base = join(process.env.APPDATA, 'Skaro/verification');
const project = '78bc2cd3-981b-40ed-a395-c6c6bc7da51b';
const directory = resolve(process.argv[2] ?? '');
assert(relative(resolve(base), directory).startsWith('archiagent-ag1-'));
const checkpoint = join(directory, 'backup-storage.json');
const proof = {
  projectId: project,
  directory,
  files: [],
  liveDatabasesChanged: false,
  deletion: false,
};
const save = () => writeFile(checkpoint, JSON.stringify(proof, null, 2));
const free = async () => {
  const fs = await statfs(base);
  return fs.bavail * fs.bsize;
};
try {
  proof.freeBefore = await free();
  const snapshots = [
    ['c4-2-preflight-3df89271-d19c-4480-8e2e-a7f220bd9421', 'before-c4-2.sqlite'],
    ['c4-2-preflight-9b96ccd2-8db4-47b4-ad37-c188a58db682', 'before-c4-2.sqlite'],
    ['c4-2-preflight-d3e7bc23-3a49-47c3-a9fb-414bb4b92c55', 'before-c4-2.sqlite'],
    ['c43-preflight-5d11bb99-9813-43a4-943b-647f6689dd23', 'before-c43.sqlite'],
    ['c4-2-preflight-531248a9-78cd-41d2-90cd-9b6eb30fa3b8', 'before-c4-2.sqlite'],
    ['coordination-preflight-331c78db-2e59-4a99-ab9b-4f6955663745', 'before-ac5.sqlite'],
    ['rc4-preflight-373a62bf-5174-47dc-b015-c43487f1d8bf', 'before-rc4.sqlite'],
    ['c43-application-fefb6170-828c-4086-ace0-3946a22e9c09', 'before-skaro.db.sqlite'],
    ['c43-application-fefb6170-828c-4086-ace0-3946a22e9c09', 'before-workspace.db.sqlite'],
    [relative(resolve(base), directory), 'before-skaro.db.sqlite'],
    [relative(resolve(base), directory), 'before-workspace.db.sqlite'],
  ];
  for (const [folder, name] of snapshots) {
    const path = resolve(base, folder, name);
    assert(
      path.startsWith(resolve(base) + '\\') &&
        name.startsWith('before-') &&
        name.endsWith('.sqlite'),
    );
    const source = JSON.parse(
      await readFile(
        join(base, folder, folder.startsWith('archiagent-ag1-') ? 'preflight.json' : 'proof.json'),
        'utf8',
      ),
    );
    assert.equal(source.projectId, project);
    const backup = source.backup ?? source.backups?.find((entry) => resolve(entry.path) === path);
    assert(backup && resolve(backup.path) === path && backup.integrity === 'ok' && backup.synced);
    assert.equal(await hashFile(path), backup.sha256);
    // A write-capable handle transparently expands WOF files. Flush before conversion, never after it.
    const handle = await open(path, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    const result = spawnSync('compact.exe', ['/C', '/EXE:LZX', '/F', path], { windowsHide: true });
    await writeFile(
      join(directory, `compact-${proof.files.length + 1}.log`),
      Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]),
    );
    assert.equal(result.status, 0, `LZX compression failed for ${path}`);
    assert.equal(await hashFile(path), backup.sha256);
    const copied = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(Object.values(copied.prepare('PRAGMA integrity_check').get())[0], 'ok');
    } finally {
      copied.close();
    }
    proof.files.push({
      path,
      sha256: backup.sha256,
      integrity: 'ok',
      sourceSyncedBeforeCompression: true,
      requestedAlgorithm: 'LZX',
      freeAfter: await free(),
    });
    await save();
    console.log(
      JSON.stringify({
        verifiedSnapshots: proof.files.length,
        freeBytes: proof.files.at(-1).freeAfter,
      }),
    );
  }
  proof.freeAfter = await free();
  proof.passed = true;
} catch (error) {
  proof.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  await save();
  console.log(
    JSON.stringify({
      checkpoint,
      passed: proof.passed,
      freeBytes: proof.freeAfter,
      error: proof.error,
    }),
  );
}
