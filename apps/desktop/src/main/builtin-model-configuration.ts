import { randomUUID } from 'node:crypto';
import type { AppDb } from '@skaro/core';
import {
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

import {
  MODEL_CONFIGURATION_KEY as KEY,
  emptyModelConfiguration as empty,
  projectModelConfiguration as project,
  nextModelConfiguration,
} from './builtin-model-configuration-state';

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
    const { state } = this.stored();
    if (state.pendingCredential) throw new Error('Credential configuration recovery is required');
    return project(state);
  }
  pendingCredential() {
    return structuredClone(this.stored().state.pendingCredential);
  }
  prepareCredential(
    expectedRevision: number,
    input: {
      connectionId: string;
      previous: NonNullable<BuiltinModelConfigurationState['pendingCredential']>['previous'];
      next: NonNullable<BuiltinModelConfigurationState['pendingCredential']>['next'];
      choices: Pick<BuiltinModelConfiguration, 'connections' | 'routes'>;
    },
  ) {
    const { raw, state } = this.stored();
    if (state.pendingCredential || expectedRevision !== state.revision)
      throw new Error('Builtin model configuration revision conflict');
    const nextState = nextModelConfiguration(state, input.choices, state.revision + 2);
    const pending = {
      id: randomUUID(),
      connectionId: input.connectionId,
      previous: input.previous,
      next: input.next,
      nextState,
    };
    const prepared = parseBuiltinModelConfiguration({
      ...state,
      revision: state.revision + 1,
      pendingCredential: pending,
    });
    if (!this.db.settings.compareAndSet(KEY, raw, prepared))
      throw new Error('Builtin model configuration changed under another writer');
    for (const lease of [...this.leases]) lease.refresh();
    return structuredClone(prepared.pendingCredential!);
  }
  finishCredential(id: string, committed: boolean) {
    const { raw, state } = this.stored();
    const pending = state.pendingCredential;
    if (!pending || pending.id !== id)
      throw new Error('Credential configuration identity conflict');
    const { pendingCredential: _pending, ...previous } = state;
    const next = parseBuiltinModelConfiguration(
      committed ? pending.nextState : { ...previous, revision: state.revision + 1 },
    );
    if (!this.db.settings.compareAndSet(KEY, raw, next))
      throw new Error('Builtin model configuration changed under another writer');
    return project(next);
  }
  update(
    expectedRevision: number,
    proposed: Pick<BuiltinModelConfiguration, 'connections' | 'routes'>,
  ): BuiltinModelConfiguration {
    const { raw, state } = this.stored();
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== state.revision)
      throw new Error('Builtin model configuration revision conflict');
    if (state.pendingCredential) throw new Error('Credential configuration recovery is required');
    const next = nextModelConfiguration(state, proposed);
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
