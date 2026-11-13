import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { git } from '@skaro/core';
import type { Services } from '../app-services';
import { cleanCompletedWorktrees } from '../task-worktree-retention';
import { sourceFingerprint } from './reclamation-observation';
import { systemDocker } from '../task-environment-docker';

/** A real failed Docker client connection; there is no daemon replacement or invented resource. */
export async function verifyArchiagentResources(s: Services, project: string) {
  // Refresh through the real production observer, never by assigning historic IDs to SQLite.
  await s.runs['engine'].environments['lifecycle'].resources.observe(await systemDocker.inspect());
  const root = s.projects.get(project).root;
  const paths = async () =>
    (await git(root, ['worktree', 'list', '--porcelain', '-z'])).stdout
      .split('\0')
      .filter((v) => v.startsWith('worktree '))
      .map((v) => v.slice(9))
      .sort();
  const beforePaths = await paths(),
    before = [];
  const unregisteredWorktrees = beforePaths.filter(
    (path) =>
      !s.db.resources
        .list(project)
        .some(
          (row) =>
            row.kind === 'worktree' &&
            row.identity.path?.replaceAll('\\', '/').toLowerCase() ===
              path.replaceAll('\\', '/').toLowerCase(),
        ),
  );
  for (const path of beforePaths) before.push({ path, source: await sourceFingerprint(path) });
  const permanent = s.db.resources
    .list(project)
    .filter((r) => r.purpose === 'project-dev' || r.preservation === 'persistent')
    .map((r) => ({
      id: r.id,
      identity: r.identity,
      generation: r.generation,
      objectIds: r.objectIds,
    }));
  const previous = { host: process.env.DOCKER_HOST, context: process.env.DOCKER_CONTEXT };
  try {
    delete process.env.DOCKER_CONTEXT;
    process.env.DOCKER_HOST = `npipe:////./pipe/skaro-ag1-unavailable-${process.pid}`;
    await assert.rejects(
      promisify(execFile)('docker', ['ps', '-aq'], { windowsHide: true, timeout: 20000 }),
    );
    // The collector intentionally resolves after recording an unavailable observation.
    await s.runs['engine'].environments.enforce();
    await cleanCompletedWorktrees(s.runs['engine']);
    assert.deepEqual(await paths(), beforePaths);
    for (const entry of before) assert.deepEqual(await sourceFingerprint(entry.path), entry.source);
    for (const entry of permanent) {
      const current = s.db.resources.get(entry.id)!;
      assert.deepEqual(
        {
          id: current.id,
          identity: current.identity,
          generation: current.generation,
          objectIds: current.objectIds,
        },
        entry,
      );
      assert.notEqual(current.state, 'released');
    }
    const observations = s.db.resources
      .list(project)
      .filter((r) => ['worktree', 'environment'].includes(r.kind) && r.state !== 'released')
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        ownership: r.ownership,
        owner: r.owner,
        lastOutcome: r.lastOutcome,
      }));
    const unknown = observations.filter(
      (r) => r.kind === 'worktree' && r.ownership !== 'registered',
    );
    assert(unknown.every((r) => r.lastOutcome?.state === 'retained' && r.lastOutcome.reason));
    assert(
      observations.some((r) =>
        ['docker-unavailable', 'docker_unavailable'].includes(r.lastOutcome?.reason ?? ''),
      ),
      'The real collector must expose unavailable retention',
    );
    return {
      actualCliConnectionFailure: true,
      daemonStopped: false,
      filesAndWorktreeRegistrationsPreserved: true,
      permanent,
      observations,
      unknownRetained: unknown.length,
      unregisteredWorktreesPreserved: unregisteredWorktrees,
      unknownWorktreeCollectorCaseAvailable: unknown.length > 0,
      dockerUnavailableRetentionObserved: observations.some((r) =>
        ['docker-unavailable', 'docker_unavailable'].includes(r.lastOutcome?.reason ?? ''),
      ),
      releasedPhysicalBytes: 0,
    };
  } finally {
    for (const [key, value] of [
      ['DOCKER_HOST', previous.host],
      ['DOCKER_CONTEXT', previous.context],
    ] as const)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
}
