import {
  resourceId,
  WorktreeRemovalBlocked,
  ResourceCleanupBlocked,
  type ResourceRecord,
} from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { worktreeResourceInventory } from './worktree-resource-inventory';
import { worktreeConsumers } from './worktree-resource-consumers';
import {
  protectedWorktreeResource,
  recordWorktreeObservation,
  worktreeOutcome,
} from './worktree-resource-records';

export interface TaskWorktreeRemoval {
  path: string;
  resource: ResourceRecord;
  stoppedRunIds: readonly string[];
  preserve: { branch: string; head: string };
}

function consumers(
  ctx: TaskRunEngine,
  projectId: string,
  path: string,
  resource: ResourceRecord,
  stoppedRunIds: readonly string[],
) {
  const detached = new Set(
    [...ctx.active.values()]
      .filter(
        (active) =>
          active.projectId === projectId &&
          stoppedRunIds.includes(active.run.id) &&
          !active.session &&
          !active.attaching &&
          !active.switching &&
          !active.stopping &&
          !active.afterTurn &&
          !active.release &&
          !active.operations.size,
      )
      .map((active) => `worktree:run:${active.run.id}`),
  );
  return [
    ...resource.consumers.filter((consumer) => !consumer.id.startsWith('worktree:')),
    // Explicit deletion overrides the historical-file retention grace, not an actual preview.
    ...worktreeConsumers(ctx, projectId, path, resource.generation).filter(
      (consumer) => consumer.id !== `worktree:access:${path}` && !detached.has(consumer.id),
    ),
  ];
}

export function taskWorktreeRemovalBlocker(
  resource: ResourceRecord,
  projectId: string,
  taskId: string,
): string | undefined {
  if (
    resource.projectId !== projectId ||
    resource.owner.kind !== 'task' ||
    resource.owner.id !== taskId ||
    resource.kind !== 'worktree' ||
    resource.purpose !== 'worktree' ||
    resource.ownership !== 'registered' ||
    resource.preservation !== 'disposable'
  )
    return 'resource ownership is unverified';
  return undefined;
}

function requireOwned(resource: ResourceRecord, projectId: string, taskId: string, path: string) {
  const reason = taskWorktreeRemovalBlocker(resource, projectId, taskId);
  if (reason) throw new WorktreeRemovalBlocked(path, reason);
}

/** The existing clean/ignored/mount preflight still applies to explicit user deletion. */
export async function prepareTaskWorktreeRemoval(
  ctx: TaskRunEngine,
  projectId: string,
  taskId: string,
  path: string,
  stoppedRunIds: readonly string[] = [],
): Promise<TaskWorktreeRemoval | undefined> {
  const db = ctx.deps.db;
  if (db.shell.projectScope && db.shell.projectScope !== projectId)
    throw new Error('Project is outside verification scope');
  const context = ctx.project(projectId);
  const [observation] = await worktreeResourceInventory(db, ctx.deps.dataDir, context, path);
  if (!observation) throw new WorktreeRemovalBlocked(path, 'resource inspection is unavailable');
  path = observation.registration.identity.path!;
  // Confirmed absence needs no filesystem deletion. The retained ownership evidence stays intact.
  if (!observation.present && observation.reason === 'path-absent') {
    const existing = db.resources.get(resourceId(observation.registration));
    if (existing) worktreeOutcome(db, existing, 'inspect', 'observed', 'worktree_path_absent');
    return undefined;
  }
  const saved = recordWorktreeObservation(db, observation);
  if (!saved.record) throw new WorktreeRemovalBlocked(path, 'resource identity is unverified');
  let resource = saved.record;
  try {
    if (saved.conflict) throw new WorktreeRemovalBlocked(path, 'resource registration conflicts');
    requireOwned(resource, projectId, taskId, path);
    resource = db.resources.update(resource.id, resource.revision, {
      consumers: consumers(ctx, projectId, path, resource, stoppedRunIds),
    });
    if (resource.consumers.length || protectedWorktreeResource(db.resources.list(), resource))
      throw new WorktreeRemovalBlocked(
        path,
        'another consumer or protected resource still uses this checkout',
      );
    await context.git.assertRemovableWorktree(path);
    if (!observation.branch || !observation.head)
      throw new WorktreeRemovalBlocked(path, 'worktree revision is unverified');
    return {
      path,
      resource,
      stoppedRunIds,
      preserve: { branch: observation.branch, head: observation.head },
    };
  } catch (error) {
    worktreeOutcome(
      db,
      resource,
      'remove',
      error instanceof WorktreeRemovalBlocked || error instanceof ResourceCleanupBlocked
        ? 'retained'
        : 'failed',
      error instanceof WorktreeRemovalBlocked
        ? 'manual_removal_blocked'
        : 'manual_preflight_failed',
    );
    throw error;
  }
}

export async function removePreparedTaskWorktree(
  ctx: TaskRunEngine,
  projectId: string,
  taskId: string,
  candidate: TaskWorktreeRemoval,
): Promise<void> {
  const { path, resource } = candidate;
  const db = ctx.deps.db;
  try {
    const guard = () => {
      if (ctx.closing || (db.shell.projectScope && db.shell.projectScope !== projectId))
        throw new WorktreeRemovalBlocked(
          path,
          'resource operation is outside the active project scope',
        );
      const current = db.resources.get(resource.id);
      if (
        !current ||
        current.generation !== resource.generation ||
        current.revision !== resource.revision
      )
        throw new WorktreeRemovalBlocked(path, 'resource changed after deletion preflight');
      requireOwned(current, projectId, taskId, path);
      if (
        consumers(ctx, projectId, path, current, candidate.stoppedRunIds).length ||
        protectedWorktreeResource(db.resources.list(), current)
      )
        throw new WorktreeRemovalBlocked(
          path,
          'another consumer or protected resource still uses this checkout',
        );
    };
    await db.resources.cleanup.run(
      resource,
      `manual.remove:${resource.id}:${resource.generation}`,
      async () => {
        guard();
        // Git repeats dirty/ignored/mount checks and removes only the exact registered checkout.
        await ctx
          .project(projectId)
          .git.removeWorktree(path, { prune: false, preserve: candidate.preserve, guard });
        db.resources.update(resource.id, resource.revision, { state: 'released', consumers: [] });
        worktreeOutcome(db, resource, 'remove', 'released', 'manual_worktree_removed');
      },
    );
  } catch (error) {
    const current = db.resources.get(resource.id);
    if (current?.generation === resource.generation)
      worktreeOutcome(
        db,
        resource,
        'remove',
        error instanceof WorktreeRemovalBlocked ? 'retained' : 'failed',
        error instanceof ResourceCleanupBlocked
          ? error.reason
          : error instanceof WorktreeRemovalBlocked
            ? 'manual_removal_blocked'
            : 'manual_removal_failed',
      );
    throw error;
  }
}
