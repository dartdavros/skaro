import type { AppDb } from '@skaro/core';
import { resourceExecution, resourcesFor } from './resource-execution';

/** Admission precedes directory creation and generation mutation, not merely Git's final spawn. */
export function admitWorktreePreparation<T>(
  ledger: AppDb['resources'] | undefined,
  project: string,
  path: string,
  action: () => Promise<T>,
): Promise<T> {
  const resources = ledger && resourcesFor(ledger);
  if (!resources) return action();
  const current = resourceExecution.getStore();
  if (current && (current.projectId !== project || current.resources !== resources))
    throw new Error('Worktree preparation is outside its resource execution owner');
  return current
    ? resources.phase('worktree', action, current)
    : resources.scope(project, `checkout:${path}`, () => resources.phase('worktree', action));
}
