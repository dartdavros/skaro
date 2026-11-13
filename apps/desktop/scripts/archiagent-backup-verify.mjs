import assert from 'node:assert/strict';
import { readFile, statfs, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashFile } from './c4-audit-application-state.mjs';

const base = resolve(process.env.APPDATA, 'Skaro/verification');
const directory = resolve(process.argv[2] ?? '');
assert(/^archiagent-ag1-[\da-f-]+$/.test(relative(base, directory)));
const names = [
  ['c4-2-preflight-b0060c8f-b6de-4122-9b27-05f95bb58e4d', 'before-c4-2.sqlite'],
  ['c4-2-preflight-3df89271-d19c-4480-8e2e-a7f220bd9421', 'before-c4-2.sqlite'],
  ['c4-2-preflight-9b96ccd2-8db4-47b4-ad37-c188a58db682', 'before-c4-2.sqlite'],
  ['c4-2-preflight-d3e7bc23-3a49-47c3-a9fb-414bb4b92c55', 'before-c4-2.sqlite'],
  ['c43-preflight-5d11bb99-9813-43a4-943b-647f6689dd23', 'before-c43.sqlite'],
  ['c4-2-preflight-531248a9-78cd-41d2-90cd-9b6eb30fa3b8', 'before-c4-2.sqlite'],
  ['coordination-preflight-331c78db-2e59-4a99-ab9b-4f6955663745', 'before-ac5.sqlite'],
  ['rc4-preflight-373a62bf-5174-47dc-b015-c43487f1d8bf', 'before-rc4.sqlite'],
  ['c43-application-fefb6170-828c-4086-ace0-3946a22e9c09', 'before-skaro.db.sqlite'],
  ['c43-application-fefb6170-828c-4086-ace0-3946a22e9c09', 'before-workspace.db.sqlite'],
  [relative(base, directory), 'before-skaro.db.sqlite'],
  [relative(base, directory), 'before-workspace.db.sqlite'],
];
const proof = {
  files: [],
  readOnly: true,
  deletion: false,
  liveDatabasesChanged: false,
  priorAttempt:
    'backup-storage.json was interrupted; a write-capable handle expanded WOF. That attempt is not a passed compression proof.',
};
try {
  for (const [folder, name] of names) {
    const path = resolve(base, folder, name);
    assert(path.startsWith(base + '\\'));
    const source = JSON.parse(
      await readFile(
        join(base, folder, folder.startsWith('archiagent-ag1-') ? 'preflight.json' : 'proof.json'),
        'utf8',
      ),
    );
    assert.equal(source.projectId, '78bc2cd3-981b-40ed-a395-c6c6bc7da51b');
    const backup = source.backup ?? source.backups?.find((entry) => resolve(entry.path) === path);
    assert(backup?.synced && backup.integrity === 'ok' && resolve(backup.path) === path);
    assert.equal(await hashFile(path), backup.sha256);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(Object.values(db.prepare('PRAGMA integrity_check').get())[0], 'ok');
    } finally {
      db.close();
    }
    proof.files.push({ path, sha256: backup.sha256, integrity: 'ok' });
  }
  proof.passed = true;
} catch (error) {
  proof.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  const fs = await statfs(base);
  proof.freeBytes = fs.bavail * fs.bsize;
  await writeFile(
    join(directory, 'storage-readonly-verification.json'),
    JSON.stringify(proof, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: proof.passed,
      verified: proof.files.length,
      freeBytes: proof.freeBytes,
      error: proof.error,
    }),
  );
}
