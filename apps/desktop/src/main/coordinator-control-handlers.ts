import type { AppDb } from '@skaro/core';
import type { Handlers } from './ipc';
import type {
  CoordinatorMigration,
  CoordinationControlMethods,
} from '../shared/coordination-control';
import { dispatchState, setCoordinationDispatch } from './coordination-dispatch';
export function coordinatorControlHandlers(
  db: AppDb,
): Pick<Handlers, keyof CoordinationControlMethods> {
  return {
    'coordinator.state': (projectId) => ({
      dispatch: dispatchState(db, projectId),
      migration: db.getSetting<CoordinatorMigration | undefined>(
        `coordination.migration.v1.${projectId}`,
        undefined,
      ),
    }),
    'coordinator.setDispatch': (projectId, enabled, revision) =>
      setCoordinationDispatch(db, projectId, enabled, revision),
  };
}
