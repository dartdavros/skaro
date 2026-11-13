import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Services } from '../app-services';
import { ResourceLifecycle } from '../resource-lifecycle';
import { cleanCompletedWorktrees } from '../task-worktree-retention';
import { worktreeAbsent } from '../worktree-absence';
import { recoveryTarget, recoveryPin, type RecoveryCase } from './resource-recovery-case';

/** Normal production collector resumes its genuine partial filesystem checkpoint. */
export async function recoverCleanup(s: Services, scenario: RecoveryCase, directory: string) {
  const checkpoint = JSON.parse(await readFile(join(directory, 'cleanup-checkpoint.json'), 'utf8'));
  const before = recoveryTarget(s.db, scenario),
    journal = new ResourceLifecycle(s.db);
  assert.equal(checkpoint.project, scenario.project);
  assert.equal(checkpoint.resource.id, before.id);
  assert.equal(checkpoint.resource.generation, before.generation);
  const old = journal.read(before, 'worktree.remove');
  assert(old && old.id === checkpoint.step.id && ['running', 'verified'].includes(old.state));
  const started = performance.now();
  recoveryPin(s.db, scenario, false);
  await cleanCompletedWorktrees(s.runs['engine']);
  const released = recoveryTarget(s.db, scenario),
    step = journal.read(released, 'worktree.remove');
  assert.equal(released.state, 'released');
  assert.equal(released.generation, before.generation);
  assert.equal(s.db.resources.cleanup.read(released.id), undefined);
  assert(await worktreeAbsent(scenario.root, scenario.target));
  assert.equal(step?.id, old.id);
  assert.equal(step?.state, 'verified');
  assert.equal(step?.attempts, checkpoint.step.attempts + 1);
  const recoveryMs = performance.now() - started;
  await cleanCompletedWorktrees(s.runs['engine']);
  assert.deepEqual(journal.read(released, 'worktree.remove'), step);
  return {
    resource: released.id,
    generation: released.generation,
    operation: step!.id,
    actualPartialCleanupResumed: true,
    replayUnchanged: true,
    recoveryMs,
    oldGenerationCheckpointPreserved: true,
    externalPendingWasFalse: !checkpoint.fence.externalPending,
  };
}

/** Real client-side Docker connection loss; never stops the daemon or serves a fake response. */
export async function unavailableRecoveryDocker(s: Services, scenario: RecoveryCase) {
  const previous = { host: process.env['DOCKER_HOST'], context: process.env['DOCKER_CONTEXT'] };
  const before = recoveryTarget(s.db, scenario),
    generation = before.generation;
  try {
    delete process.env['DOCKER_CONTEXT'];
    process.env['DOCKER_HOST'] = `npipe:////./pipe/skaro-rc4-unavailable-${process.pid}`;
    recoveryPin(s.db, scenario, false);
    await cleanCompletedWorktrees(s.runs['engine']);
    const held = recoveryTarget(s.db, scenario);
    assert.equal(held.lastOutcome?.reason, 'docker-unavailable');
    assert.equal(held.lastOutcome.state, 'retained');
    assert.equal(held.generation, generation);
    assert((await readFile(join(scenario.target, 'index.html'))).length > 0);
    return {
      resource: held.id,
      generation,
      reason: held.lastOutcome.reason,
      actualCliConnectionFailure: true,
      daemonStopped: false,
      noDeletion: true,
      returnRequiresFreshProcessAndDockerObservation: true,
    };
  } finally {
    recoveryPin(s.db, scenario, true);
    for (const [key, value] of [
      ['DOCKER_HOST', previous.host],
      ['DOCKER_CONTEXT', previous.context],
    ] as const)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
}
