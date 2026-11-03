import { isDeepStrictEqual } from 'node:util';
import {
  openRouterCatalog,
  parseOpenRouterCatalog,
  requireOpenRouterCatalogRoute,
  authenticatedCatalog,
  parseDirectCatalog,
  requireDirectCatalogRoute,
  type ModelFetch,
} from '@skaro/agent-runtime';
import type { Connection, RouteSnapshot, RuntimeModelRequest } from '@skaro/timeline';
import type { ModelCatalogSnapshot } from '../shared/model-catalog';
import type { BuiltinModelConfigurationStore } from './builtin-model-configuration';
import { modelNetworkTransport } from './model-network-transport';
import type { BuiltinModelSettingsService } from './builtin-model-settings-service';

/** Advertised public metadata only, never account availability or permission to run a model. */
export class BuiltinModelCatalog {
  private readonly store: BuiltinModelConfigurationStore;
  private readonly options: {
    verification: boolean;
    proxy?: string;
    credentials?: Pick<BuiltinModelSettingsService, 'withMetadataCredential'>;
  };
  private transport?: Promise<ModelFetch>;
  private closed = false;
  private readonly pending = new Map<
    string,
    { connection: Connection; controller: AbortController; promise: Promise<ModelCatalogSnapshot> }
  >();
  private readonly cache = new Map<
    string,
    { connection: Connection; value: ModelCatalogSnapshot }
  >();
  constructor(
    store: BuiltinModelConfigurationStore,
    options: {
      verification: boolean;
      proxy?: string;
      credentials?: Pick<BuiltinModelSettingsService, 'withMetadataCredential'>;
    },
  ) {
    this.store = store;
    this.options = { ...options };
  }
  private connection(id: string, revision: number) {
    if (this.closed) throw new Error('Model catalog is closing');
    const value = this.store.read().connections.find((entry) => entry.id === id);
    if (!value || value.revision !== revision)
      throw new Error('Model connection is no longer current');
    const profiles: Record<string, string> = {
      openrouter: 'openrouter.chat-completions',
      openai: 'openai.responses',
      anthropic: 'anthropic.messages',
      deepseek: 'deepseek.chat-completions',
    };
    if (value.apiProfile.revision !== 1 || profiles[value.connector] !== value.apiProfile.id)
      throw new Error('Model catalog is not implemented for this API profile');
    return value;
  }
  async read(id: string, revision: number, refresh = false): Promise<ModelCatalogSnapshot> {
    const connection = this.connection(id, revision);
    const saved = this.cache.get(id);
    if (
      !refresh &&
      saved &&
      isDeepStrictEqual(saved.connection, connection) &&
      Date.now() - saved.value.fetchedAt < 60_000
    )
      return structuredClone(saved.value);
    const previous = this.pending.get(id);
    if (previous && isDeepStrictEqual(previous.connection, connection))
      return structuredClone(await previous.promise);
    previous?.controller.abort();
    const controller = new AbortController();
    const promise = this.load(connection, controller.signal);
    const pending = { connection, controller, promise };
    this.pending.set(id, pending);
    try {
      return structuredClone(await promise);
    } finally {
      if (this.pending.get(id) === pending) this.pending.delete(id);
    }
  }
  private async load(connection: Connection, signal: AbortSignal): Promise<ModelCatalogSnapshot> {
    if (this.options.verification && !this.options.proxy)
      throw new Error('Verification catalog requires the explicit owner VPN proxy');
    this.transport ??= modelNetworkTransport(this.options.proxy);
    const load = await this.transport;
    signal.throwIfAborted();
    const models =
      connection.connector === 'openrouter'
        ? parseOpenRouterCatalog(
            await openRouterCatalog(connection.endpoint, signal, load),
            connection.id,
          )
        : await this.direct(connection, signal, load);
    signal.throwIfAborted();
    if (!isDeepStrictEqual(this.connection(connection.id, connection.revision), connection))
      throw new Error('Model connection changed during catalog retrieval');
    const value: ModelCatalogSnapshot = {
      connectionId: connection.id,
      connectionRevision: connection.revision,
      fetchedAt: Date.now(),
      evidence: 'catalog',
      models,
    };
    this.cache.delete(connection.id);
    this.cache.set(connection.id, { connection, value });
    if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }
  private async direct(connection: Connection, signal: AbortSignal, load: ModelFetch) {
    const profile = connection.connector;
    if (profile !== 'openai' && profile !== 'anthropic' && profile !== 'deepseek')
      throw new Error('Expected direct metadata profile');
    if (!this.options.credentials)
      throw new Error('Direct model catalog requires protected credential access');
    const raw = await this.options.credentials.withMetadataCredential(
      connection,
      signal,
      (secret, active) =>
        authenticatedCatalog(
          connection.endpoint,
          connection.connector === 'anthropic' ? 'anthropic' : 'bearer',
          secret,
          active,
          load,
        ),
    );
    return parseDirectCatalog(raw, connection.id, profile);
  }
  /** Current advertised facts only. Readiness, payload permission and budget remain separate. */
  async requireCurrent(
    route: RouteSnapshot,
    request: RuntimeModelRequest | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const catalog = await this.read(route.connectionId, route.connectionRevision);
    signal.throwIfAborted();
    const current = this.store.snapshot(route.routeId, catalog.models);
    if (!isDeepStrictEqual(current, route)) throw new Error('Catalog route is no longer current');
    if (route.connector === 'openrouter')
      requireOpenRouterCatalogRoute(route, catalog.models, request);
    else requireDirectCatalogRoute(route, catalog.models, request);
    signal.throwIfAborted();
  }
  async close() {
    this.closed = true;
    for (const entry of this.pending.values()) entry.controller.abort();
    await Promise.allSettled([...this.pending.values()].map((entry) => entry.promise));
    this.cache.clear();
  }
}
