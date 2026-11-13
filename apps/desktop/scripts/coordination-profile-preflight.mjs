import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const projectId = '78bc2cd3-981b-40ed-a395-c6c6bc7da51b';
const stage = process.argv[2] ?? 'ac5';
assert(/^[a-z0-9-]{1,30}$/.test(stage));
const data = join(process.env.APPDATA, 'Skaro');
const directory = join(
  data,
  'verification',
  `${stage === 'ac5' ? 'coordination' : stage}-preflight-${randomUUID()}`,
);
await mkdir(directory, { recursive: true });
const source = new DatabaseSync(join(data, 'skaro.db'), { readOnly: true });
const backup = join(directory, `before-${stage}.sqlite`);
const proof = { projectId, directory };
try {
  const project = source.prepare('SELECT id,name,path FROM projects WHERE id=?').get(projectId);
  assert.equal(project?.name, 'Cat-pilot');
  // Read a consistent SQLite snapshot, including committed WAL pages.
  source.prepare('VACUUM INTO ?').run(backup);
  const handle = await open(backup, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  const copied = new DatabaseSync(backup, { readOnly: true });
  try {
    assert.equal(Object.values(copied.prepare('PRAGMA integrity_check').get())[0], 'ok');
    assert.deepEqual(
      copied.prepare('SELECT id,name,path FROM projects WHERE id=?').get(projectId),
      project,
    );
  } finally {
    copied.close();
  }
  proof.backup = {
    path: backup,
    sha256: createHash('sha256')
      .update(await readFile(backup))
      .digest('hex'),
    integrity: 'ok',
    synced: true,
  };
  const runs = source
    .prepare(
      'SELECT id,task_id,agent,worktree,log_path FROM runs WHERE project_id=? AND retired_at IS NULL ORDER BY started_at DESC,rowid DESC',
    )
    .all(projectId);
  const latest = new Map();
  for (const run of runs) if (!latest.has(run.task_id)) latest.set(run.task_id, run);
  proof.latestRuns = [...latest.values()];
  proof.historyCounts = {
    chats: source.prepare('SELECT count(*) n FROM chats WHERE project_id=?').get(projectId).n,
    runs: runs.length,
  };
  proof.passed = true;
} catch (error) {
  proof.error = String(error);
  process.exitCode = 1;
} finally {
  source.close();
  await writeFile(join(directory, 'proof.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
}
