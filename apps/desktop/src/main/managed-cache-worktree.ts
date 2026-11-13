import { join } from 'node:path';
import type { AppDb, ResourceLeaseRequest } from '@skaro/core';
type ResourceLock = ResourceLeaseRequest['locks'][number];
import type { SkaroScope } from '@skaro/mcp-server';
import { canonicalCachePath } from './managed-cache-files';

export interface ManagedTaskSource {
  projectId: string;
  taskId: string;
  runId: string;
  branch: string;
  cwd: string;
  resourceId: string;
  generation: number;
}
export async function managedTaskSource(
  db: AppDb,
  dataDir: string,
  scope: SkaroScope,
): Promise<ManagedTaskSource> {
  if (scope.kind !== 'task' || !scope.taskId || !scope.runId || scope.importId)
    throw new Error('managed_cache_current_task_scope_required');
  const run = db.getRun(scope.runId);
  if (
    !run ||
    run.projectId !== scope.projectId ||
    run.taskId !== scope.taskId ||
    run.endedAt ||
    !run.worktree ||
    !run.branch
  )
    throw new Error('managed_cache_current_isolated_run_required');
  const cwd = await canonicalCachePath(join(dataDir, 'worktrees'), run.worktree);
  const resource = db.resources
    .list(scope.projectId)
    .find((x) => x.kind === 'worktree' && x.identity.path === cwd);
  if (
    !resource ||
    resource.state === 'released' ||
    resource.ownership !== 'registered' ||
    resource.owner.kind !== 'task' ||
    resource.owner.id !== scope.taskId ||
    resource.preservation !== 'disposable' ||
    resource.purpose !== 'worktree' ||
    resource.source?.recovery !== run.branch
  )
    throw new Error('managed_cache_worktree_ownership_unverified');
  return {
    projectId: scope.projectId,
    taskId: scope.taskId,
    runId: scope.runId,
    branch: run.branch,
    cwd,
    resourceId: resource.id,
    generation: resource.generation,
  };
}
export async function managedSourceLock(
  db: AppDb,
  dataDir: string,
  projectId: string,
  cwd: string,
  source?: ManagedTaskSource,
): Promise<ResourceLock> {
  if (!source || source.projectId !== projectId || source.cwd !== cwd)
    throw new Error('managed_cache_current_task_source_required');
  const current = await managedTaskSource(db, dataDir, {
    kind: 'task',
    projectId,
    taskId: source.taskId,
    runId: source.runId,
  });
  if (JSON.stringify(current) !== JSON.stringify(source))
    throw new Error('managed_cache_worktree_generation_or_identity_changed');
  return { resourceId: source.resourceId, generation: source.generation, mode: 'shared' };
}
