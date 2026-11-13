import { resolve } from 'node:path';
import { worktreeAbsent } from './worktree-absence';
import { ResourceLifecycle } from './resource-lifecycle';
import { confirmRemovedWorktree } from './worktree-removal-recovery';
import {
  removeCompletedIntegrationWorktree,
  resourceId,
  WorktreeRemovalBlocked,
  ResourceCleanupBlocked,
} from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { integrationEnvironmentKey, type IntegrationOperation } from './integration-model';
import { errorText } from './session-log';
import { backgroundWork } from './background-work';
import { protectedWorktreeResource, worktreeOutcome } from './worktree-resource-records';
import {
  integrationRecoveryRef,
  integrationRemovalKey,
  integrationResourceBlocker,
  integrationResourceConsumers,
  integrationResourceObservation,
  type IntegrationRemovalCheckpoint,
} from './integration-resource-retention';

import { integrationRetirementEligible as finished } from './integration-retirement-policy';

/** Retain the journal and exact recovery ref; dispose only the proven idle candidate generation. */
export async function retireIntegration(
  ctx: TaskRunEngine,
  op: IntegrationOperation,
): Promise<void> {
  if (!finished(op) || ctx.closing) return;
  const db = ctx.deps.db;
  if (db.shell.projectScope && db.shell.projectScope !== op.projectId) return;
  const id = resourceId({
    projectId: op.projectId,
    kind: 'worktree',
    identity: { path: resolve(op.worktree) },
  });
  if (!db.getProject(op.projectId)) {
    const existing = db.resources.get(id);
    if (existing) worktreeOutcome(db, existing, 'remove', 'retained', 'owner-project-unavailable');
    return;
  }
  try {
    // Same order as prepare -> verify: neither candidate admission nor a resolver can race cleanup.
    await ctx.integrations.service.serial(`${op.projectId}:${op.taskId}:${op.purpose}`, () =>
      ctx.integrations.service.serial(op.id, async () => {
        const current = ctx.integrations.store.find(op.projectId, op.id);
        if (!current || !finished(current) || ctx.closing) {
          const existing = db.resources.get(id);
          if (existing)
            worktreeOutcome(db, existing, 'remove', 'retained', 'integration-owner-unavailable');
          return;
        }
        await retireCandidate(ctx, current);
      }),
    );
  } catch (error) {
    const record = db.resources.get(id);
    if (record)
      worktreeOutcome(
        db,
        record,
        'remove',
        error instanceof WorktreeRemovalBlocked || error instanceof ResourceCleanupBlocked
          ? 'retained'
          : 'failed',
        error instanceof ResourceCleanupBlocked
          ? error.reason
          : error instanceof Error && error.message.includes('Docker mount dependencies')
            ? 'docker-unavailable'
            : 'integration-cleanup-blocked',
      );
    else
      db.addEvent(op.projectId, 'resource_retained', {
        integration: op.id,
        reason: 'integration-inspection-unavailable',
      });
    console.error(`integration ${op.id} cleanup: ${errorText(error)}`);
  }
}

async function retireCandidate(ctx: TaskRunEngine, op: IntegrationOperation): Promise<void> {
  const db = ctx.deps.db;
  const context = ctx.project(op.projectId);
  const observation = await integrationResourceObservation(db, ctx.deps.dataDir, context, op);
  const id = resourceId(observation.registration);
  let record = db.resources.get(id);
  if (!observation.present) {
    if (record) await confirmRemovedWorktree(db, record, context.root);
    return;
  }
  // A transient unavailable inspection must not permanently adopt an ambiguous classification.
  if (!record && observation.reason === 'inspection-unavailable') {
    db.addEvent(op.projectId, 'resource_retained', {
      integration: op.id,
      reason: observation.reason,
    });
    return;
  }
  record ??= db.resources.register(observation.registration);
  const retain = (reason: string) => worktreeOutcome(db, record!, 'remove', 'retained', reason);
  if (observation.reason !== 'integration-checkout-verified') {
    retain(observation.reason);
    return;
  }
  record = db.resources.update(record.id, record.revision, {
    consumers: [
      ...record.consumers.filter((consumer) => !consumer.id.startsWith('integration-checkout:')),
      ...integrationResourceConsumers(ctx, op, record.generation),
    ],
  });
  const reason = integrationResourceBlocker(record, op);
  if (reason || protectedWorktreeResource(db.resources.list(), record)) {
    retain(reason ?? 'protected-overlapping-resource');
    return;
  }
  const expected = record;
  const guard = () => {
    const owner = ctx.integrations.store.find(op.projectId, op.id);
    const latest = db.resources.get(expected.id);
    if (
      !owner ||
      !finished(owner) ||
      owner.updatedAt !== op.updatedAt ||
      owner.head !== op.head ||
      owner.worktree !== op.worktree ||
      owner.fingerprint !== op.fingerprint ||
      ctx.closing ||
      !latest ||
      latest.generation !== expected.generation ||
      latest.revision !== expected.revision ||
      integrationResourceBlocker(latest, owner) ||
      protectedWorktreeResource(db.resources.list(), latest) ||
      integrationResourceConsumers(ctx, owner, latest.generation).length
    )
      throw new WorktreeRemovalBlocked(op.worktree, 'Integration ownership or consumers changed');
  };
  await backgroundWork.run(
    'merge.retire',
    {
      projectId: op.projectId,
      project: db.getProject(op.projectId)?.name ?? '',
      task: op.taskId,
      merge: op.id.slice(0, 8),
    },
    () =>
      db.resources.cleanup.run(
        expected,
        `integration.remove:${op.id}:${expected.id}:${expected.generation}`,
        async () => {
          guard();
          await ctx.removeEnvironment(integrationEnvironmentKey(op), { requireSuccess: true });
          await ctx.processes.stop(`verification-${op.id}`);
          guard();
          await new ResourceLifecycle(db).run(expected, 'worktree.remove', {
            guard,
            verify: () => worktreeAbsent(context.root, op.worktree),
            execute: () =>
              removeCompletedIntegrationWorktree(
                context.root,
                op.worktree,
                {
                  head: op.head,
                  ref: integrationRecoveryRef(op.id),
                  resuming: observation.resuming,
                },
                guard,
                () => {
                  db.setSetting(integrationRemovalKey(op.id), {
                    id: op.id,
                    projectId: op.projectId,
                    worktree: op.worktree,
                    head: op.head,
                    fingerprint: op.fingerprint,
                    resourceId: expected.id,
                    generation: expected.generation,
                  } satisfies IntegrationRemovalCheckpoint);
                  worktreeOutcome(
                    db,
                    expected,
                    'remove',
                    'observed',
                    'integration-cleanup-started',
                  );
                },
              ),
          });
          guard();
          const released = db.resources.update(expected.id, expected.revision, {
            state: 'released',
          });
          worktreeOutcome(db, released, 'remove', 'released', 'integration-checkout-removed');
        },
      ),
  );
}
