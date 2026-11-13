import assert from 'node:assert/strict';
import { readFile, writeFile, open, realpath, copyFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { ArtifactStore, git, type AppDb, type ResourceRecord } from '@skaro/core';
import { TaskExecution } from '../task-execution';
import { protectedFingerprint } from './reclamation-observation';
import { RESOURCE_POLICY_KEY } from '../resource-policy';

export async function durableRecoveryJson(path: string, value: unknown) {
  await writeFile(path, JSON.stringify(value, null, 2));
  const handle = await open(path, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function saveRecoveryPhaseProof(directory: string, phase: string, proof: unknown) {
  const output = join(directory, `${phase}-proof.json`);
  const previous = join(directory, `${phase}-previous-${randomUUID()}.json`);
  try {
    await copyFile(output, previous);
    const handle = await open(previous, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await durableRecoveryJson(output, proof);
}
export interface RecoveryCase {
  project: string;
  root: string;
  target: string;
  run: string;
  resource: string;
  pin: string;
  originalPolicy: unknown;
  protected: Awaited<ReturnType<typeof protectedFingerprint>>;
}
export function recoveryTarget(db: AppDb, scenario: RecoveryCase): ResourceRecord {
  const target = db.resources.get(scenario.resource);
  assert(
    target && target.projectId === scenario.project && target.identity.path === scenario.target,
  );
  assert(
    target.owner.kind === 'task' &&
      target.owner.id === 'T-013' &&
      target.ownership === 'registered',
  );
  assert(target.preservation === 'disposable' && target.purpose === 'worktree');
  return target;
}
/** Protect all other resources, including explicit user previews, before ordinary startup recovery. */
export function recoveryPin(db: AppDb, scenario: RecoveryCase, includeTarget: boolean) {
  for (const row of db.resources.list(scenario.project)) {
    if (row.state === 'released') continue;
    const wanted = row.id !== scenario.resource || includeTarget;
    if (wanted === row.consumers.some((c) => c.id === scenario.pin)) continue;
    db.resources.update(row.id, row.revision, {
      consumers: wanted
        ? [...row.consumers, { id: scenario.pin, kind: 'verification', generation: row.generation }]
        : row.consumers.filter((c) => c.id !== scenario.pin),
    });
  }
}
export async function prepareRecoveryCase(db: AppDb, data: string, directory: string) {
  const project = db.shell.projectScope!;
  try {
    const old = JSON.parse(await readFile(join(directory, 'case.json'), 'utf8')) as RecoveryCase;
    assert.equal(old.project, project);
    recoveryTarget(db, old);
    return old;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const root = db.getProject(project)!.path,
    run = db.latestRun(project, 'T-013');
  assert(run?.worktree);
  assert.equal(resolve(await realpath(run.worktree)), resolve(data, 'worktrees', project, 'T-013'));
  const artifacts = await new ArtifactStore(root).load();
  assert.equal(artifacts.tasks.find((t) => t.id === 'T-013')?.status, 'done');
  assert.equal(new TaskExecution(db, run.id).read().enabled, false);
  assert.equal(
    (await git(run.worktree, ['rev-parse', 'HEAD'])).stdout.trim(),
    '75138acc5cd1a769fc2ade158144454c1fa1ec26',
  );
  assert.equal(db.listMerges(project, 'T-013').length, 1);
  assert(
    !db.admission
      .all()
      .some((l) => l.projectId === project && ['granted', 'retained'].includes(l.state)),
  );
  const record = db.resources.list(project).find((r) => r.identity.path === run.worktree)!;
  assert(record && !record.consumers.length);
  assert(!db.resources.cleanup.read(record.id));
  const scenario: RecoveryCase = {
    project,
    root,
    target: run.worktree,
    run: run.id,
    resource: record.id,
    pin: `verification:rc4:${directory.split(/[\\/]/).at(-1)}`,
    originalPolicy: db.getSetting(RESOURCE_POLICY_KEY, {}),
    protected: await protectedFingerprint(db, project, root, data, ['T-013']),
  };
  await durableRecoveryJson(join(directory, 'case.json'), scenario);
  return scenario;
}
export async function verifyRecoveryProtection(db: AppDb, data: string, scenario: RecoveryCase) {
  assert.deepEqual(
    await protectedFingerprint(db, scenario.project, scenario.root, data, ['T-013']),
    scenario.protected,
  );
  assert.deepEqual(db.getSetting(RESOURCE_POLICY_KEY, {}), scenario.originalPolicy);
  return { sourcesHistoriesRefsPreserved: true, policyRestored: true };
}
