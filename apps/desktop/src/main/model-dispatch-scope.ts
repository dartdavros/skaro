import type { AppDb } from '@skaro/core';
import type { ResourceExecution } from './resource-execution';
import { requireCoordinationDispatch } from './coordination-dispatch';
/** A quota/resource wait cannot cross an off/on generation and regain a model permit. */
export function modelDispatchScope(db: AppDb, kind: string, scope?: ResourceExecution) {
  if (kind !== 'model' || !scope || /^(task|review|integration):/.test(scope.ownerId)) return scope;
  const revision = requireCoordinationDispatch(
    db,
    scope.projectId,
    scope.dispatchRevision,
  ).revision;
  return {
    ...scope,
    requireCurrent: async () => {
      await scope.requireCurrent();
      requireCoordinationDispatch(db, scope.projectId, revision);
    },
  };
}
