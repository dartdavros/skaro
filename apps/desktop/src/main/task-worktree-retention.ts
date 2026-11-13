import {
  git,
  removeCompletedWorktree,
  resourceId,
  WorktreeRemovalBlocked,
  ResourceCleanupBlocked,
} from '@skaro/core';
import { isDeepStrictEqual } from 'node:util';
import type { TaskRunEngine } from './task-run-engine';
import { environmentArtifacts } from './task-environment-finished';
import { serializeTaskMutation } from './project-task-mutations';
import { ResourceLifecycle } from './resource-lifecycle';
import { publishedCheckout } from './worktree-publication';
import { worktreeAbsent } from './worktree-absence';
import { confirmRemovedWorktree } from './worktree-removal-recovery';

import { completedCheckout, recordKey, type RetainedCheckout } from './worktree-retention-model';
import { worktreeResourceInventory } from './worktree-resource-inventory';
import { worktreeConsumers } from './worktree-resource-consumers';
import {
  protectedWorktreeResource,
  recordWorktreeObservation,
  worktreeOutcome,
} from './worktree-resource-records';
export {
  checkoutTaskIds,
  completedCheckout,
  restoredCheckoutInUse,
} from './worktree-retention-model';

/** Durable inventory never grants cleanup by directory name, Git ignores or a mount alone. */
export async function cleanCompletedWorktrees(ctx: TaskRunEngine): Promise<void> {
  const db = ctx.deps.db;
  for (const project of db.listProjects()) {
    if (ctx.closing) return;
    if (db.shell.projectScope && db.shell.projectScope !== project.id) continue;
    const context = ctx.project(project.id);
    for (const initial of await worktreeResourceInventory(db, ctx.deps.dataDir, context)) {
      if (ctx.closing) return;
      if (!initial.present) {
        const resource = db.resources.get(resourceId(initial.registration));
        if (resource) await confirmRemovedWorktree(db, resource, context.root);
        continue;
      }
      const path = initial.registration.identity.path!;
      await serializeTaskMutation(context, async () => {
        const [observation] = await worktreeResourceInventory(db, ctx.deps.dataDir, context, path);
        if (!observation?.present || ctx.closing) return;
        const { record, conflict } = recordWorktreeObservation(db, observation);
        if (!record) return; // Transient inspection failure was recorded at project level.
        const retain = (reason: string) =>
          worktreeOutcome(db, record, 'remove', 'retained', reason);
        if (conflict) {
          retain('registration-conflict');
          return;
        }
        if (
          record.ownership !== 'registered' ||
          record.preservation !== 'disposable' ||
          record.purpose !== 'worktree'
        ) {
          retain(observation.reason);
          return;
        }
        const consumers = [
          ...record.consumers.filter((consumer) => !consumer.id.startsWith('worktree:')),
          ...worktreeConsumers(ctx, project.id, path, record.generation),
        ];
        if (!isDeepStrictEqual(record.consumers, consumers)) {
          if (db.resources.cleanup.read(record.id)) {
            retain('cleanup-consumers-changed');
            return;
          }
          db.resources.update(record.id, record.revision, { consumers });
        }
        if (consumers.length) {
          retain('active-consumer');
          return;
        }
        if (!observation.completed) {
          retain(observation.reason);
          return;
        }
        if (protectedWorktreeResource(db.resources.list(), record)) {
          retain('protected-nested-resource');
          return;
        }
        try {
          const owners = db.listRuns(project.id).filter((run) => run.worktree === path);
          const artifacts = await environmentArtifacts(context);
          if (!artifacts) {
            retain('task-metadata-unavailable');
            return;
          }
          if (
            !owners.length ||
            !completedCheckout(artifacts.tasks, record.owner.id) ||
            owners.some((run) => !completedCheckout(artifacts.tasks, run.taskId))
          ) {
            retain('unfinished-owner');
            return;
          }
          for (const run of owners) await ctx.processes.stop(run.id);
          const branch = await context.git.currentBranch(path);
          const head = (await git(path, ['rev-parse', 'HEAD'])).stdout.trim();
          if (
            !branch ||
            branch !== observation.branch ||
            head !== observation.head ||
            (await git(context.root, ['rev-parse', `refs/heads/${branch}`])).stdout.trim() !== head
          ) {
            retain('branch-changed');
            return;
          }
          const fresh = await environmentArtifacts(context);
          if (
            !fresh ||
            !(await publishedCheckout(db, project.id, context.root, head, fresh.config.baseBranch))
          ) {
            retain('publication-not-proven');
            return;
          }
          if (
            ctx.closing ||
            !fresh ||
            !completedCheckout(fresh.tasks, record.owner.id) ||
            owners.some((run) => !completedCheckout(fresh.tasks, run.taskId)) ||
            worktreeConsumers(ctx, project.id, path, record.generation).length
          ) {
            retain('inputs-changed');
            return;
          }
          const current = db.resources.get(record.id)!;
          if (current.generation !== record.generation) {
            worktreeOutcome(db, current, 'remove', 'retained', 'generation-changed');
            return;
          }
          if (current.consumers.length || protectedWorktreeResource(db.resources.list(), current)) {
            retain('active-consumer');
            return;
          }
          const lifecycle = new ResourceLifecycle(db);
          const oldStep = lifecycle.read(current, 'worktree.remove');
          const oldSaved = db.getSetting<RetainedCheckout | undefined>(recordKey(path), undefined, {
            strict: true,
          });
          const proof = oldSaved?.trackedClean;
          const resuming =
            !!proof &&
            proof.resourceId === current.id &&
            proof.generation === current.generation &&
            proof.branch === branch &&
            proof.head === head &&
            oldStep?.id === proof.operationId &&
            ['running', 'failed'].includes(oldStep.state);
          // Recovery intent precedes deletion; clean-diff proof is published only at its checkpoint.
          const saved: RetainedCheckout = {
            branch,
            head,
            cleanedAt: Date.now(),
            ...(resuming ? { trackedClean: proof } : {}),
          };
          db.setSetting(recordKey(path), saved);
          const guard = () => {
            const latest = db.resources.get(record.id);
            if (
              !latest ||
              latest.generation !== record.generation ||
              latest.state === 'released' ||
              latest.consumers.length ||
              latest.source?.commit !== head ||
              latest.source?.recovery !== branch ||
              protectedWorktreeResource(db.resources.list(), latest) ||
              worktreeConsumers(ctx, project.id, path, record.generation).length
            )
              throw new WorktreeRemovalBlocked(path, 'Resource ownership or consumers changed');
          };
          await db.resources.cleanup.run(
            current,
            `worktree.remove:${current.id}:${current.generation}`,
            async () => {
              await lifecycle.run(current, 'worktree.remove', {
                guard,
                verify: () => worktreeAbsent(context.root, path),
                execute: () =>
                  removeCompletedWorktree(
                    context.root,
                    path,
                    { branch, head, resuming },
                    guard,
                    () => {
                      const step = lifecycle.read(current, 'worktree.remove');
                      if (!step || step.state !== 'running')
                        throw new Error('Missing cleanup checkpoint');
                      db.setSetting(recordKey(path), {
                        ...saved,
                        trackedClean: {
                          resourceId: current.id,
                          generation: current.generation,
                          operationId: step.id,
                          branch,
                          head,
                        },
                      } satisfies RetainedCheckout);
                    },
                  ),
              });
              db.resources.update(current.id, current.revision, { state: 'released' });
              worktreeOutcome(db, current, 'remove', 'released', 'completed-checkout-removed');
            },
          );
        } catch (error) {
          const blocked =
            error instanceof WorktreeRemovalBlocked || error instanceof ResourceCleanupBlocked;
          const latest = db.resources.get(record.id);
          if (!latest) throw error;
          worktreeOutcome(
            db,
            latest,
            'remove',
            blocked ? 'retained' : 'failed',
            error instanceof ResourceCleanupBlocked
              ? error.reason
              : error instanceof Error && error.message.includes('Docker mount dependencies')
                ? 'docker-unavailable'
                : 'cleanup-blocked',
          );
        }
      });
    }
  }
}

export { accessTaskWorktree, restoreCleanedWorktree } from './task-worktree-restore';
