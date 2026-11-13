import { git, ResourceCleanupBlocked, type AppDb, type ResourceRecord } from '@skaro/core';
import { ResourceLifecycle } from './resource-lifecycle';
import { worktreeAbsent } from './worktree-absence';
import { worktreeOutcome } from './worktree-resource-records';

/** Finalize only our recorded operation; an arbitrary missing path never proves cleanup. */
export async function confirmRemovedWorktree(db: AppDb, resource: ResourceRecord, root: string) {
  const fence = db.resources.cleanup.read(resource.id);
  if (
    (resource.state === 'released' && !fence) ||
    resource.ownership !== 'registered' ||
    resource.preservation !== 'disposable' ||
    resource.consumers.length ||
    !resource.identity.path ||
    !resource.source?.commit ||
    !resource.source.recovery
  )
    return;
  const journal = new ResourceLifecycle(db);
  const operation = journal.read(resource, 'worktree.remove');
  if (!operation || operation.generation !== resource.generation) return;
  const ref =
    resource.purpose === 'integration'
      ? resource.source.recovery
      : `refs/heads/${resource.source.recovery}`;
  if (
    (
      await git(root, ['rev-parse', '--verify', ref], { env: { GIT_NO_REPLACE_OBJECTS: '1' } })
    ).stdout.trim() !== resource.source.commit
  )
    return;
  if (!(await worktreeAbsent(root, resource.identity.path))) return;
  const guard = () => {
    const latest = db.resources.get(resource.id);
    if (
      !latest ||
      latest.revision !== resource.revision ||
      latest.generation !== resource.generation ||
      latest.consumers.length
    )
      throw new Error('Worktree cleanup ownership changed');
  };
  await db.resources.cleanup
    .run(
      resource,
      fence?.operationId ?? `worktree.remove:${resource.id}:${resource.generation}`,
      async () => {
        await journal.run(resource, 'worktree.remove', {
          guard,
          verify: () => worktreeAbsent(root, resource.identity.path!),
          execute: () => {
            throw new Error('Absent worktree reconciliation never deletes files');
          },
        });
        guard();
        const released = db.resources.update(resource.id, resource.revision, { state: 'released' });
        worktreeOutcome(db, released, 'remove', 'released', 'checkout-removal-reconciled');
      },
    )
    .catch((error: unknown) => {
      if (error instanceof ResourceCleanupBlocked)
        worktreeOutcome(db, resource, 'remove', 'retained', error.reason);
      else throw error;
    });
}
