import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { c4Hash, git } from '@skaro/core';
import type { Services } from '../app-services';
import { RESOURCE_POLICY_KEY } from '../resource-policy';
import { restoreCleanedWorktree } from '../task-worktree-restore';
import { cleanCompletedWorktrees } from '../task-worktree-retention';
import { serializeTaskMutation } from '../project-task-mutations';
import { ResourceLifecycle } from '../resource-lifecycle';
import { eventually } from './resource-workflow-observation';
import { recoveryPin, recoveryTarget, type RecoveryCase } from './resource-recovery-case';

/** Real resource policy pressure, exact historical checkout and ordinary production cleanup. */
export async function recoveryCycles(s: Services, scenario: RecoveryCase) {
  const ctx = s.runs['engine'],
    context = s.projects.get(scenario.project),
    run = s.db.getRun(scenario.run)!;
  const original = s.db.getSetting<Record<string, unknown>>(RESOURCE_POLICY_KEY, {});
  const owner = `${scenario.pin}:restore`,
    results = [];
  const start = recoveryTarget(s.db, scenario);
  assert.equal(start.state, 'released');
  const restore = () =>
    s.resources.scope(scenario.project, owner, () =>
      serializeTaskMutation(context, async () => {
        await restoreCleanedWorktree(ctx, run);
        recoveryPin(s.db, scenario, true);
      }),
    );
  try {
    s.db.setSetting(RESOURCE_POLICY_KEY, { ...original, reserveRamBytes: 2 ** 50 });
    const waiting = restore().then(
      () => ({ granted: true }),
      (error) => ({ error: String(error) }),
    );
    const lease = await eventually(
      () => s.db.admission.all().findLast((l) => l.ownerId === owner),
      (l) => l?.state === 'waiting_resource',
      'real RAM reservation pressure',
    );
    assert(lease);
    assert(!existsSync(scenario.target));
    assert.deepEqual(
      recoveryTarget(s.db, scenario),
      start,
      'Waiting must not mutate resource generation',
    );
    s.resources.stopOwner(scenario.project, owner);
    assert('error' in (await waiting));
    s.db.setSetting(RESOURCE_POLICY_KEY, original);
    s.resources.manager.poke();
    assert.equal(s.db.admission.get(scenario.project, lease.id)?.state, 'stopped_by_owner');
    assert(!existsSync(scenario.target));
    for (let cycle = 0; cycle < 2; cycle++) {
      const before = recoveryTarget(s.db, scenario),
        begun = performance.now();
      await restore();
      const current = recoveryTarget(s.db, scenario);
      assert.equal(current.generation, before.generation + 1);
      assert.equal(
        (await git(scenario.target, ['rev-parse', 'HEAD'])).stdout.trim(),
        before.source!.commit,
      );
      assert.equal(
        (
          await git(scenario.target, ['status', '--porcelain', '--untracked-files=no'])
        ).stdout.trim(),
        '',
      );
      const sourceHash = c4Hash(await readFile(join(scenario.target, 'index.html'), 'utf8'));
      const preserved = new ResourceLifecycle(s.db).read(current, 'worktree.remove');
      let staleEffect = false;
      await assert.rejects(
        new ResourceLifecycle(s.db).run(before, 'worktree.remove', {
          guard: () => undefined,
          verify: () => false,
          execute: async () => {
            staleEffect = true;
          },
        }),
        /generation changed/,
      );
      assert.equal(staleEffect, false);
      assert.deepEqual(new ResourceLifecycle(s.db).read(current, 'worktree.remove'), preserved);
      const restoredMs = performance.now() - begun,
        cleanupStarted = performance.now();
      recoveryPin(s.db, scenario, false);
      await cleanCompletedWorktrees(ctx);
      assert.equal(recoveryTarget(s.db, scenario).state, 'released');
      assert(!existsSync(scenario.target));
      assert(!s.db.resources.cleanup.read(current.id));
      results.push({
        cycle: cycle + 1,
        generation: current.generation,
        sourceHash,
        restoredMs,
        cleanupMs: performance.now() - cleanupStarted,
        staleGenerationRejected: true,
      });
    }
    const owned = s.db.admission.all().filter((l) => l.ownerId === owner);
    assert(owned.every((l) => ['released', 'stopped_by_owner'].includes(l.state)));
    return {
      blockedLease: lease.id,
      noMaterializationOrGenerationMutationWhileWaiting: true,
      stoppedDidNotResume: true,
      cycles: results,
      physicalWorktreesAddedAtEnd: 0,
      admissionWaits: owned.map((l) => ({
        id: l.id,
        state: l.state,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt,
        lifecycleMs: l.updatedAt - l.createdAt,
        reason: l.reason,
      })),
    };
  } finally {
    s.resources.stopOwner(scenario.project, owner);
    s.db.setSetting(RESOURCE_POLICY_KEY, original);
    s.resources.manager.poke();
  }
}
