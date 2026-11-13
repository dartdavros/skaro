import assert from 'node:assert/strict';
import { lstat, readFile, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { git, labelsOf, COMPOSE_PROJECT } from '@skaro/core';
import type { Services } from '../app-services';
import { localDataObjects } from '../local-version-target';
import { systemDocker } from '../task-environment-docker';
import { cleanCompletedWorktrees } from '../task-worktree-retention';
import { cleanCompletedIntegrations } from '../integration-cleanup';

/** Inspect actual completion cleanup while a real browser still consumes the installed main contour. */
export async function verifyArchiagentCleanup(s: Services, project: string, directory: string) {
  const local = JSON.parse(
    await readFile(join(directory, 'local-before-acceptance-proof.json'), 'utf8'),
  ).local;
  const context = s.projects.get(project),
    engine = s.runs['engine'];
  const target = s.db.collections
    .all<import('../../shared/local-versions').LocalVersionTarget>(
      `coordination.local-targets.${project}`,
    )
    .find((t) => t.id === 'cat-pilot-dev')!;
  const main = async () =>
    (await systemDocker.inspect()).filter((c) => labelsOf(c)[COMPOSE_PROJECT] === 'cat-pilot-dev');
  const before = await main(),
    spaceBefore = await statfs(s.dataDir);
  assert(before.length && before.every((c) => c.State?.Running));
  const ids = before.map((c) => c.Id).sort(),
    data = localDataObjects(before);
  assert(s.resources.holdings(project, 'local-environment:cat-pilot-dev').length > 0);
  await engine.environments.enforce();
  await cleanCompletedIntegrations(engine);
  await cleanCompletedWorktrees(engine);
  const after = await main();
  assert.deepEqual(after.map((c) => c.Id).sort(), ids);
  assert(after.every((c) => c.State?.Running));
  assert.equal(localDataObjects(after), data);
  const response = await fetch(target.ready, { signal: AbortSignal.timeout(10000) });
  assert(response.ok);
  assert.equal(
    await response.text(),
    await readFile(join(local.receipt.release, 'index.html'), 'utf8'),
  );
  const run = s.db.latestRun(project, local.task)!;
  const taskPresent = !!(await lstat(run.worktree!).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  }));
  const candidate = s.runs['engine'].integrations.store.find(
    project,
    local.manifest.integrationId,
  )!;
  const candidatePresent = !!(await lstat(candidate.worktree).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  }));
  const outcomes = s.db.resources
    .list(project)
    .filter(
      (r) =>
        r.identity.path === run.worktree ||
        r.identity.path === candidate.worktree ||
        r.identity.path === local.receipt.release,
    )
    .map((r) => ({
      id: r.id,
      path: r.identity.path,
      state: r.state,
      preservation: r.preservation,
      outcome: r.lastOutcome,
    }));
  assert(
    !taskPresent && !candidatePresent,
    'Disposable task and candidate checkouts must actually be removed',
  );
  assert((await lstat(local.receipt.release)).isDirectory());
  assert(
    (await git(context.root, ['worktree', 'list', '--porcelain'])).stdout
      .replaceAll('\\', '/')
      .includes(local.receipt.release.replaceAll('\\', '/')),
  );
  const spaceAfter = await statfs(s.dataDir);
  return {
    taskCheckoutRemoved: !taskPresent,
    candidateCheckoutRemoved: !candidatePresent,
    permanentObjects: ids,
    permanentStillRunning: true,
    activeBrowserAndRuntimeConsumer: true,
    dataPreserved: true,
    immutableInstalledReleaseRetained: true,
    outcomes,
    hostFreeBefore: spaceBefore.bavail * spaceBefore.bsize,
    hostFreeAfter: spaceAfter.bavail * spaceAfter.bsize,
    hostDeltaIsNotAttributableFreedBytes: true,
  };
}
