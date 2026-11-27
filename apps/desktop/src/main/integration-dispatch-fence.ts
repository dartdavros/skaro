import type { AppDb } from '@skaro/core';
import { CoordinationSuspended } from './coordination-dispatch';

const key = (project: string, id: string) => `coordination.integration-fence.${project}.${id}`;
export function integrationDispatchCandidates(db: AppDb, project: string) {
  return db.collections
    .all<{ id: string; state: string }>(`integration.${project}.operations`)
    .filter((op) => !['applied', 'stale'].includes(op.state))
    .map((op) => op.id);
}
export function fenceIntegrationDispatch(db: AppDb, project: string, ids: readonly string[]) {
  for (const id of ids) db.setSetting(key(project, id), true);
}
export function requireIntegrationDispatch(db: AppDb, project: string, id: string) {
  if (db.getSetting(key(project, id), false, { strict: true }) !== false)
    throw new CoordinationSuspended();
}
/** Only the original owner message/decision executor renews an old candidate after off/on. */
export function renewIntegrationDispatch(db: AppDb, project: string, id: string) {
  db.setSetting(key(project, id), false);
}
