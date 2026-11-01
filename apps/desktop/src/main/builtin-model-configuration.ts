import { isDeepStrictEqual } from 'node:util';
import type { AppDb } from '@skaro/core';
import {
  parseBuiltinModelChoices,
  parseBuiltinModelConfiguration,
  type BuiltinModelConfigurationState,
} from '@skaro/agent-runtime';
import {
  snapshotRoute,
  type BuiltinModelConfiguration,
  type Model,
  type RouteSnapshot,
  type CredentialReference,
} from '@skaro/timeline';
import { BuiltinModelRouteLease } from './builtin-model-route-lease';

const KEY = 'builtin.model-configuration';
const empty = (): BuiltinModelConfigurationState => ({
  schema: 1,
  revision: 0,
  connections: [],
  routes: [],
  connectionVersions: [],
  routeVersions: [],
});
const project = (state: BuiltinModelConfigurationState): BuiltinModelConfiguration =>
  structuredClone({
    schema: state.schema,
    revision: state.revision,
    connections: state.connections,
    routes: state.routes,
  });

/** Main-only nonsecret choices. This store neither imports keys nor grants model execution. */
export class BuiltinModelConfigurationStore {
  private readonly db: AppDb;
  private readonly leases = new Set<BuiltinModelRouteLease>();
  constructor(db: AppDb) {
    this.db = db;
  }
  private stored() {
    const raw = this.db.settings.getSetting<unknown>(KEY, undefined, { strict: true });
    return { raw, state: raw === undefined ? empty() : parseBuiltinModelConfiguration(raw) };
  }
  read(): BuiltinModelConfiguration {
    return project(this.stored().state);
  }
  update(
    expectedRevision: number,
    proposed: Pick<BuiltinModelConfiguration, 'connections' | 'routes'>,
  ): BuiltinModelConfiguration {
    const { raw, state } = this.stored();
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== state.revision)
      throw new Error('Builtin model configuration revision conflict');
    const value = parseBuiltinModelChoices(proposed);
    const versions = <T extends { id: string; revision: number }>(
      previous: readonly T[],
      next: readonly T[],
      history: { id: string; revision: number }[],
    ) => {
      const current = new Map(previous.map((entry) => [entry.id, entry]));
      const revisions = new Map(history.map((entry) => [entry.id, entry.revision]));
      for (const entry of next) {
        if (
          !isDeepStrictEqual(current.get(entry.id), entry) &&
          entry.revision !== (revisions.get(entry.id) ?? 0) + 1
        )
          throw new Error('Builtin model entry requires its next configuration revision');
        revisions.set(entry.id, entry.revision);
      }
      return [...revisions].map(([id, revision]) => ({ id, revision }));
    };
    const next = parseBuiltinModelConfiguration({
      schema: 1,
      revision: state.revision + 1,
      ...value,
      connectionVersions: versions(state.connections, value.connections, state.connectionVersions),
      routeVersions: versions(state.routes, value.routes, state.routeVersions),
    });
    if (!this.db.settings.compareAndSet(KEY, raw, next))
      throw new Error('Builtin model configuration changed under another writer');
    for (const lease of [...this.leases]) lease.refresh();
    return project(next);
  }
  admit(route: RouteSnapshot, credential: CredentialReference) {
    if (this.leases.size >= 256) throw new Error('Builtin model configuration lease limit reached');
    const lease = new BuiltinModelRouteLease(
      () => this.read(),
      route,
      credential,
      (lease) => this.leases.delete(lease),
    );
    this.leases.add(lease);
    return lease;
  }
  /** Current catalog required. Disappearance fails explicitly; persisted choices remain intact. */
  snapshot(routeId: string, models: readonly Model[]) {
    const config = this.read();
    const route = config.routes.find((route) => route.id === routeId);
    if (!route) throw new Error('Configured builtin model route is unavailable');
    return snapshotRoute(route, config.connections, models);
  }
}
