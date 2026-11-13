import type { AppDb } from '@skaro/core';
import type { ResourceExecution } from './resource-execution';
import { requireCoordinationDispatch } from './coordination-dispatch';
import { requireIntegrationDispatch } from './integration-dispatch-fence';
/** A quota/resource wait cannot cross an off/on generation and regain a model permit. */
export function modelDispatchScope(db: AppDb, kind: string, scope?: ResourceExecution) {
  if (kind !== 'model' || !scope) return scope;
  const revision = requireCoordinationDispatch(
    db,
    scope.projectId,
    scope.dispatchRevision,
  ).revision;
  if (scope.ownerId.startsWith('integration:'))
    requireIntegrationDispatch(db, scope.projectId, scope.ownerId.slice('integration:'.length));
  return {
    ...scope,
    requireCurrent: async () => {
      await scope.requireCurrent();
      requireCoordinationDispatch(db, scope.projectId, revision);
      if (scope.ownerId.startsWith('integration:'))
        requireIntegrationDispatch(db, scope.projectId, scope.ownerId.slice('integration:'.length));
    },
  };
}
