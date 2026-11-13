import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import type { Services } from '../app-services';
import { TaskExecution } from '../task-execution';
import { ResourceLifecycle } from '../resource-lifecycle';
import { verifyResourceOwnerDecisions } from './resource-recovery-owner-state';
import { verifyC4CoordinationBrowser } from './c4-coordination-browser';
import { auditRecoveryDocker } from './resource-recovery-docker-audit';
import {
  recoveryTarget,
  verifyRecoveryProtection,
  type RecoveryCase,
} from './resource-recovery-case';

/** Audit only existing real receipts and sources; no manufactured task/provider outcomes. */
export async function finishResourceRecovery(
  s: Services,
  scenario: RecoveryCase,
  directory: string,
) {
  const phases = [
    'inspect',
    'recover-reader',
    'docker-unavailable',
    'recover-cleanup',
    'cycles',
    'model-wait',
    'model-unavailable',
  ];
  for (const phase of phases) {
    const proof = JSON.parse(await readFile(join(directory, `${phase}-proof.json`), 'utf8'));
    assert(proof.passed && !proof.cleanupError, `${phase} must have completed normally`);
  }
  const target = recoveryTarget(s.db, scenario);
  const docker = await auditRecoveryDocker(s.db, scenario.project, scenario.root, directory);
  assert.equal(target.state, 'released');
  assert(!s.db.resources.cleanup.read(target.id));
  assert.equal(new ResourceLifecycle(s.db).read(target, 'worktree.remove')?.state, 'verified');
  assert(
    !s.db.admission
      .all()
      .some((l) => l.projectId === scenario.project && ['granted', 'retained'].includes(l.state)),
  );
  const intents = [];
  const ownerDecisions = await verifyResourceOwnerDecisions(s.db, scenario.project);
  const admissionEvents = s.db
    .listEvents(scenario.project, 5000)
    .filter(
      (event) =>
        event.kind === 'resource_admission' && String(event.data.owner).startsWith(scenario.pin),
    );
  const admissionTimings = s.db.admission
    .all()
    .filter((lease) => lease.ownerId.startsWith(scenario.pin))
    .map((lease) => {
      const granted = admissionEvents
        .filter((event) => event.data.id === lease.id && event.data.state === 'granted')
        .at(-1);
      return {
        id: lease.id,
        owner: lease.ownerId,
        state: lease.state,
        waitMs: granted ? granted.at - lease.createdAt : null,
        stoppedWaitMs:
          lease.state === 'stopped_by_owner' ? lease.updatedAt - lease.createdAt : null,
      };
    });
  for (const id of ['T-010', 'T-011', 'T-012', 'T-013']) {
    const run = s.db.latestRun(scenario.project, id)!;
    const execution = new TaskExecution(s.db, run.id).read();
    assert.equal(execution.enabled, false, `${id} must not resume`);
    intents.push({ task: id, run: run.id, execution });
  }
  const browser = await verifyC4CoordinationBrowser(s, scenario.project, directory, 'T-013', true);
  assert.equal(
    browser.after.pixels,
    '14f666eca43dba6bdd022bc299ba2c62ea2ee47959c50a16aa8b9d6b631872d6',
  );
  await verifyRecoveryProtection(s.db, s.dataDir, scenario);
  const remaining = (await git(scenario.root, ['worktree', 'list', '--porcelain', '-z'])).stdout
    .split('\0')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice(9));
  const tasks = (await s.projects.get(scenario.project).store.load()).tasks;
  const remainingWorktrees = remaining.map((path) => {
    const row = s.db.resources
      .list(scenario.project)
      .find(
        (r) =>
          r.identity.path?.replaceAll('\\', '/').toLowerCase() ===
          path.replaceAll('\\', '/').toLowerCase(),
      );
    return {
      path,
      owner: row?.owner ?? { kind: 'unknown', id: path },
      resource: row?.id,
      reason: row?.consumers.some((consumer) => consumer.id !== scenario.pin)
        ? 'active_or_external_consumer'
        : row?.owner.kind === 'project'
          ? 'project_owned_checkout_preserved'
          : row?.owner.kind === 'task' &&
              tasks.find((task) => task.id === row.owner.id)?.status !== 'done'
            ? 'unfinished_owner'
            : 'unregistered_git_worktree_retained_no_deletion_authority',
    };
  });
  // Retire only this driver's exact generation pins; never an external preview or another owner.
  const removed = [];
  for (const row of s.db.resources.list(scenario.project)) {
    if (!row.consumers.some((c) => c.id === scenario.pin)) continue;
    s.db.resources.update(row.id, row.revision, {
      consumers: row.consumers.filter((c) => c.id !== scenario.pin),
    });
    removed.push({ id: row.id, generation: row.generation });
  }
  assert(
    !s.db.resources
      .list(scenario.project)
      .some((row) => row.consumers.some((consumer) => consumer.id === scenario.pin)),
  );
  return {
    target: { id: target.id, generation: target.generation, state: target.state },
    remainingWorktrees,
    intents,
    ownerDecisions,
    admissionTimings,
    browser,
    verificationPinsRemoved: removed,
    verificationPinsRemaining: 0,
    activeReservations: 0,
    docker,
    successfulModelResponses: 0,
    nativeTransportProbe: 'One real configured client with an unavailable child-scoped proxy',
    scope:
      'Windows, real Cat-pilot, existing published task checkout; client connection failure and configured account cap',
    unverified: [
      'Provider-wide network outage',
      'Docker daemon crash/restart',
      'hardware power loss',
      'new task implementation cycle',
    ],
  };
}
