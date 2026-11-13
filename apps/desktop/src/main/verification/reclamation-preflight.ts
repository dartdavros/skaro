import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { catPilotProjectId } from './cat-pilot-state';
import { ArtifactStore, git, type AppDb, type ResourceRecord } from '@skaro/core';
import { IntegrationStore } from '../integration-store';
import { publishedCheckout } from '../worktree-publication';
import { protectedWorktreeResource } from '../worktree-resource-records';
import { accessKey, recordKey, type RetainedCheckout } from '../worktree-retention-model';

const taskId = 'T-005';
const exact = { env: { GIT_NO_REPLACE_OBJECTS: '1' } };

/** AppState normally resets stale runtime; this verification must not change unrelated task state. */
export function reclamationStartupGuard(data: string): void {
  assert.equal(
    process.env.SKARO_RC3_CLEANUP_TASK,
    taskId,
    'Explicit T-005 cleanup authorization is required',
  );
  const projectId = catPilotProjectId(data);
  const registry = new DatabaseSync(join(data, 'skaro.db'), { readOnly: true });
  try {
    const running = registry
      .prepare(
        "SELECT task_id FROM task_runtime WHERE project_id=? AND state IN ('running','queued')",
      )
      .all(projectId);
    assert.equal(
      running.length,
      0,
      'Reconcile existing Cat-pilot runtime separately before this verification',
    );
  } finally {
    registry.close();
  }
}

/** Validate the real owner-authorized target BEFORE creating services or triggering cleanup. */
export async function reclamationPreflight(db: AppDb, data: string) {
  assert.equal(
    process.env.SKARO_RC3_CLEANUP_TASK,
    taskId,
    'Explicit T-005 cleanup authorization is required',
  );
  const projectId = db.shell.projectScope;
  assert(projectId && db.shell.get(projectId)?.name.toLowerCase() === 'cat-pilot');
  assert(
    !db.commands.pending().some((command) => command.args[0] === projectId),
    'Pending Cat-pilot owner commands must be handled separately, never replayed by this verification',
  );
  assert(
    !db.coordination
      .pending(projectId)
      .some(
        (operation) => operation.state === 'uncertain' && operation.id.startsWith('owner-command:'),
      ),
    'Uncertain Cat-pilot owner commands require separate reconciliation before service startup',
  );
  const root = db.shell.get(projectId)!.path;
  const task = await new ArtifactStore(root).readTask(taskId);
  assert.equal(task.status, 'done', 'Never manufacture completion to authorize cleanup');
  const run = db.listRuns(projectId, taskId)[0];
  assert(run?.worktree && run.branch, 'Use the real recorded completed checkout');
  const target = resolve(data, 'worktrees', projectId, taskId);
  assert.equal(resolve(run.worktree), target);
  const info = await lstat(target);
  assert(info.isDirectory() && !info.isSymbolicLink());
  assert.equal(resolve(await realpath(target)), target);
  const head = (await git(target, ['rev-parse', 'HEAD'], exact)).stdout.trim();
  assert.equal(
    (await git(root, ['rev-parse', `refs/heads/${run.branch}`], exact)).stdout.trim(),
    head,
  );
  assert.equal(
    (await git(target, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored'], exact))
      .stdout,
    '',
    'Verification must not delete unknown ignored/untracked or modified task bytes',
  );
  const config = (await new ArtifactStore(root).load()).config;
  assert(
    await publishedCheckout(db, projectId, root, head, config.baseBranch),
    'Exact publication must be proven',
  );
  const record = db.resources.list(projectId).find((row) => row.identity.path === target);
  assert(
    record &&
      record.state !== 'released' &&
      record.ownership === 'registered' &&
      record.preservation === 'disposable' &&
      record.purpose === 'worktree' &&
      record.owner.kind === 'task' &&
      record.owner.id === taskId,
  );
  assert(!protectedWorktreeResource(db.resources.list(projectId), record));
  const allowedPin = `worktree:access:${target}`;
  assert(
    record.consumers.every((consumer) => consumer.id === allowedPin),
    'A real consumer blocks the approved cleanup',
  );
  assert(
    !db.admission
      .all()
      .some(
        (lease) =>
          lease.projectId === projectId &&
          ['granted', 'retained', 'waiting_resource', 'waiting_quota'].includes(lease.state),
      ),
    'Do not interfere with current or queued Cat-pilot operations',
  );
  const operations = new IntegrationStore(db, data).all(projectId);
  assert(
    operations.every(
      (op) =>
        !op.worker &&
        !op.executor &&
        !op.publish &&
        (['applied', 'stale'].includes(op.state) ||
          (op.purpose === 'local' && op.state === 'ready')),
    ),
    'Startup recovery must not launch an unrelated operation during reclamation verification',
  );
  const saved = db.getSetting<RetainedCheckout | null>(recordKey(target), null);
  assert(
    saved?.branch === run.branch && saved.head === head,
    'Use the exact previously preserved target',
  );
  return { projectId, root, run, target, head, record, allowedPin };
}

/** Temporary real verification consumers protect all non-target resources from startup cleanup. */
export function protectVerificationResources(db: AppDb, target: ResourceRecord) {
  const id = `verification:rc3:${randomUUID()}`;
  const protectedIds: string[] = [];
  const release = () => {
    for (const resourceId of protectedIds) {
      const current = db.resources.get(resourceId);
      if (!current || !current.consumers.some((consumer) => consumer.id === id)) continue;
      db.resources.update(current.id, current.revision, {
        consumers: current.consumers.filter((consumer) => consumer.id !== id),
      });
    }
  };
  try {
    for (const record of db.resources.list(target.projectId)) {
      if (record.id === target.id || record.state === 'released') continue;
      db.resources.update(record.id, record.revision, {
        consumers: [
          ...record.consumers,
          { id, kind: 'verification', generation: record.generation },
        ],
      });
      protectedIds.push(record.id);
    }
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

/** Owner confirmed this exact previous verification pin is no longer used; never release others. */
export function releasePreviousVerificationAccess(
  db: AppDb,
  input: Awaited<ReturnType<typeof reclamationPreflight>>,
) {
  const { record, allowedPin, target } = input;
  const current = db.resources.get(record.id);
  assert(current && current.generation === record.generation);
  assert(current.consumers.every((consumer) => consumer.id === allowedPin));
  db.resources.update(current.id, current.revision, { consumers: [] });
  db.setSetting(accessKey(target), 0);
  db.addEvent(record.projectId, 'resource_verification_access_released', {
    resource: record.id,
    generation: record.generation,
    reason: 'owner_authorized_T005_verification',
  });
}
