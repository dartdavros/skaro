import type { AppDb } from '@skaro/core';
import type { C4TaskCoordination } from './c4-task-coordination';
import type { C4ProposalRecord } from './c4-service';
import type { C4Package } from '@skaro/core';

const controllers = new WeakMap<AppDb, C4TaskCoordination>();
const routes = new WeakMap<
  AppDb,
  {
    read(id: string, project: string): Promise<C4Package>;
    publish(record: C4ProposalRecord): Promise<void>;
  }
>();
export function bindC4Coordination(db: AppDb, controller: C4TaskCoordination) {
  if (controllers.has(db)) throw new Error('C4 coordinator already bound');
  controllers.set(db, controller);
}
export const c4Coordination = (db: AppDb) => controllers.get(db);
export function bindC4Packages(db: AppDb, router: NonNullable<ReturnType<typeof c4Packages>>) {
  routes.set(db, router);
}
export const c4Packages = (db: AppDb) => routes.get(db);
