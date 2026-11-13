import assert from 'node:assert/strict';
import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { c4Hash } from '@skaro/core';
import type { Services } from '../app-services';
import { processBirth } from '../process-identity';
import { cleanCompletedWorktrees } from '../task-worktree-retention';
import {
  recoveryTarget,
  recoveryPin,
  durableRecoveryJson,
  type RecoveryCase,
} from './resource-recovery-case';

/** A real source read holds a real shared lease; owner process exits without releasing it. */
export async function crashRecoveryReader(s: Services, scenario: RecoveryCase, directory: string) {
  const resource = recoveryTarget(s.db, scenario);
  await s.resources.scope(scenario.project, `${scenario.pin}:reader`, async () => {
    const held = await s.resources.acquire('process', undefined, {
      checkpoint: 'rc4-read-only-source',
      locks: [{ resourceId: resource.id, generation: resource.generation, mode: 'shared' }],
    });
    const source = await readFile(join(scenario.target, 'index.html'), 'utf8');
    const birth = await processBirth(process.pid);
    assert(birth);
    await durableRecoveryJson(join(directory, 'reader-checkpoint.json'), {
      project: scenario.project,
      resource: resource.id,
      generation: resource.generation,
      lease: held.lease,
      sourceHash: c4Hash(source),
      owner: { pid: process.pid, birth, platform: process.platform },
      externalExecutor: false,
      readFinished: true,
      at: new Date().toISOString(),
    });
    app.exit(75);
  });
  throw new Error('Reader crash did not terminate its actual process');
}
export async function recoverReader(s: Services, scenario: RecoveryCase, directory: string) {
  const checkpoint = JSON.parse(await readFile(join(directory, 'reader-checkpoint.json'), 'utf8'));
  assert.equal(checkpoint.project, scenario.project);
  assert.equal(checkpoint.resource, scenario.resource);
  assert(checkpoint.readFinished && checkpoint.externalExecutor === false);
  assert.notEqual(
    await processBirth(checkpoint.owner.pid),
    checkpoint.owner.birth,
    'Old reader owner must have exited',
  );
  const held = s.db.admission.get(scenario.project, checkpoint.lease.id)!;
  assert.equal(held.state, 'retained');
  assert.equal(held.checkpoint, 'rc4-read-only-source');
  assert.equal(held.ownerId, `${scenario.pin}:reader`);
  recoveryPin(s.db, scenario, false);
  await cleanCompletedWorktrees(s.runs['engine']);
  assert.equal(recoveryTarget(s.db, scenario).lastOutcome?.reason, 'active-consumer');
  assert.equal(
    c4Hash(await readFile(join(scenario.target, 'index.html'), 'utf8')),
    checkpoint.sourceHash,
  );
  assert.equal(s.db.admission.get(scenario.project, held.id)!.state, 'retained');
  recoveryPin(s.db, scenario, true);
  s.resources.manager.release(
    held,
    'exact_verification_reader_owner_exit_and_no_external_executor_verified',
  );
  return {
    lease: held.id,
    retainedAcrossRestart: true,
    cleanupBlockedByConsumer: true,
    sourcePreserved: true,
    releasedAfterPhysicalOwnerExit: true,
  };
}
