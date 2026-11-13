import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { GitSnapshot, git } from '@skaro/core';
import type { Services } from '../app-services';
import { recordKey, type RetainedCheckout } from '../worktree-retention-model';
import { ResourceLifecycle } from '../resource-lifecycle';
import { reclamationInventory, sameDockerObjects } from './reclamation-observation';
import type { reclamationPreflight } from './reclamation-preflight';

export async function verifyReclamationHistory(
  services: Services,
  input: Awaited<ReturnType<typeof reclamationPreflight>>,
  data: string,
  proof: Record<string, unknown>,
) {
  const { projectId, root, run, target, head } = input;
  const engine = services.runs['engine'];
  await engine.cleanup.run();
  const released = services.db.resources.get(input.record.id);
  assert(
    !existsSync(target),
    `Authorized checkout was retained: ${released?.lastOutcome?.reason ?? 'unknown'}`,
  );
  assert.equal(released?.state, 'released');
  const journal = new ResourceLifecycle(services.db).read(released!, 'worktree.remove');
  assert.equal(journal?.state, 'verified');
  const saved = services.db.getSetting<RetainedCheckout | null>(recordKey(target), null);
  assert(saved?.head === head && saved.branch === run.branch && saved.trackedClean);
  proof.removal = { resource: released!.id, generation: released!.generation, journal };
  const baseline = await reclamationInventory(root, data, target);
  proof.afterCleanup = baseline;
  await engine.cleanup.run();
  assert.deepEqual(
    new ResourceLifecycle(services.db).read(released!, 'worktree.remove'),
    journal,
    'Repeated sweep must not repeat a verified removal',
  );
  assert(
    (await services.runs.files.suggest(projectId, run.taskId, 'index')).some(
      (file) => file.path === 'index.html',
    ),
  );
  assert.deepEqual(
    await services.runs.files.exist(projectId, run.taskId, ['index.html', '../index.html']),
    ['index.html'],
  );
  assert.deepEqual(await services.runs.files.diff(projectId, run.taskId, 'index.html'), {
    status: 'unchanged',
    diff: '',
  });
  let exported: string | undefined;
  await services.runs.files.open(projectId, run.taskId, 'index.html', async (path) => {
    const bytes = await readFile(path);
    assert.deepEqual(bytes, await new GitSnapshot(root, head).read('index.html'));
    exported = path;
    proof.exportHash = createHash('sha256').update(bytes).digest('hex');
  });
  assert(exported && !existsSync(target));
  const afterRead = await reclamationInventory(root, data, target);
  assert.equal(afterRead.worktrees, baseline.worktrees);
  sameDockerObjects(baseline, afterRead);
  proof.history = {
    taskId: run.taskId,
    head,
    exported,
    noMaterialization: true,
    unchangedDiff: true,
    consumer: 'verification-readFile',
    nativeApplicationHandoff: false,
  };
  // Actual explicit product operation, not a fabricated branch or checkout.
  const priorLeaseIds = new Set(services.db.admission.all().map((lease) => lease.id));
  const checkout = await services.runs.workdir(projectId, run.taskId);
  assert.equal(resolve(checkout), target);
  assert.equal(
    (
      await git(checkout, ['rev-parse', 'HEAD'], { env: { GIT_NO_REPLACE_OBJECTS: '1' } })
    ).stdout.trim(),
    head,
  );
  const creation = services.db.admission
    .all()
    .filter(
      (lease) =>
        !priorLeaseIds.has(lease.id) &&
        lease.projectId === projectId &&
        lease.ownerId === `checkout:${target}` &&
        lease.checkpoint === 'worktree',
    );
  assert(
    creation.length > 0 && creation.every((lease) => lease.state === 'released'),
    'This exact restoration must acquire and release a new worktree admission',
  );
  const current = services.db.resources.get(input.record.id);
  assert(current && current.generation > released!.generation);
  assert(
    current.consumers.some((consumer) => consumer.id.startsWith('explicit-access:')),
    'Explicit working-copy access must have a durable consumer',
  );
  await engine.cleanup.run();
  assert(existsSync(checkout), 'An active explicit consumer must retain a completed checkout');
  assert.equal((await services.projects.get(projectId).store.readTask(run.taskId)).status, 'done');
  proof.restored = {
    taskId: run.taskId,
    head,
    path: checkout,
    generation: current.generation,
    leases: creation.map((lease) => lease.id),
    consumers: current.consumers,
    outcome: services.db.resources.get(current.id)?.lastOutcome,
  };
  proof.afterRestoration = await reclamationInventory(root, data, target);
  proof.liveLimitations = [
    'Cat-pilot has no dependency lockfile or Dockerfile: real dependency/BuildKit cache publishing and eviction are not exercised.',
    'No artificial files, images, volumes, fake services or changed task completion states were created.',
    'Provider quota exhaustion, OS crash and Docker failure/recovery were not induced.',
    'Fingerprints cover tracked and nonignored untracked source, branch refs and run logs, not ignored file bytes or persistent/unknown volume contents; non-target ledger resources are separately pinned.',
    'The actual exported bytes are consumed by verification readFile, not a launched native application; OS handoff and editor closure are not verified.',
    'The product access APIs conservatively pin the exported file and restored checkout; this verification does not bypass or auto-release those pins.',
  ];
}
