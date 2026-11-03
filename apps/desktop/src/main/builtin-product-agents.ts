import { app } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  agentCatalog,
  agentRegistration,
  newSettingsAgent,
  BUILTIN_PRODUCT_RELEASED,
  type AgentId,
  type AgentCatalogEntry,
} from '@skaro/agents';
import { AgentManager } from './agents';
import type { AgentInfo } from '../shared/ipc';
import type { AgentModel, AgentUserConfig } from '@skaro/timeline';
import { catalogEfforts, effortParameter } from '@skaro/agent-runtime/catalog-effort';
import type { BuiltinSessionModelDependencies } from './builtin-session-models';
import { configuredBuiltinConnection } from './builtin-connection-ready';

export function productAgentCatalog(): AgentCatalogEntry[] {
  const icon = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'build/icon.png');
  return [
    ...agentCatalog().map((entry) => ({
      ...entry,
      newSettingsDefault: entry.id === newSettingsAgent(undefined),
    })),
    {
      id: 'skaro',
      name: 'Skaro',
      newSettingsDefault: newSettingsAgent(undefined) === 'skaro',
      boardLogoSize: 17,
      logo: {
        viewBox: '0 0 1 1',
        paths: [],
        image: `data:image/png;base64,${readFileSync(icon).toString('base64')}`,
      },
    },
  ];
}

/** Bundled readiness and routes have no npm installation, CLI login or subscription window. */
export class ProductAgents extends AgentManager {
  private readonly builtin: Pick<BuiltinSessionModelDependencies, 'store' | 'settings' | 'catalog'>;
  private readonly dataDir: string;
  private builtinInfo: AgentInfo;
  private readonly notify: ConstructorParameters<typeof AgentManager>[0]['onChange'];
  constructor(
    options: ConstructorParameters<typeof AgentManager>[0],
    builtin: Pick<BuiltinSessionModelDependencies, 'store' | 'settings' | 'catalog'>,
    dataDir: string,
  ) {
    super(options);
    this.notify = options.onChange;
    this.builtin = builtin;
    this.dataDir = dataDir;
    const entry = agentRegistration('skaro');
    if (!('adapterVersion' in entry)) throw new Error('Bundled runtime is unavailable');
    this.builtinInfo = {
      id: 'skaro',
      delivery: 'bundled',
      inDevelopment: !BUILTIN_PRODUCT_RELEASED,
      installed: true,
      version: entry.adapterVersion,
      authenticated: false,
      sizeBytes: 0,
    };
  }
  override list() {
    return [...super.list(), this.builtinInfo];
  }
  override readyAgent(preferred: AgentId): AgentId {
    if (preferred === 'skaro') return preferred;
    const list = super.list();
    if (list.find((entry) => entry.id === preferred)?.checking) return preferred;
    return (
      list.find(
        (entry) => entry.id === preferred && entry.installed && entry.authenticated !== false,
      )?.id ??
      list.find((entry) => entry.installed && entry.authenticated !== false)?.id ??
      preferred
    );
  }
  override async refresh() {
    await super.refresh();
    await this.refreshOne('skaro');
    return this.list();
  }
  override async refreshOne(id: AgentId): Promise<AgentInfo> {
    if (id !== 'skaro') return super.refreshOne(id);
    try {
      const state = await this.builtin.settings.read();
      const configured = state.configuration.routes.some((route) =>
        configuredBuiltinConnection(state, route.connectionId),
      );
      this.builtinInfo = {
        ...this.builtinInfo,
        authenticated: configured,
        configurationRevision: state.configuration.revision,
        error: undefined,
      };
    } catch {
      this.builtinInfo = {
        ...this.builtinInfo,
        authenticated: false,
        error: 'Model configuration is unavailable',
      };
    }
    this.notify(this.list());
    return this.builtinInfo;
  }
  override async requireReady(id: AgentId) {
    if (id !== 'skaro') return super.requireReady(id);
    if (!BUILTIN_PRODUCT_RELEASED) throw new Error('Skaro is in development');
    if (!(await this.refreshOne(id)).authenticated)
      throw new Error('Builtin model connection and route are not configured');
  }
  override async install(id: AgentId) {
    if (id === 'skaro') throw new Error('Builtin runtime is delivered with Skaro');
    return super.install(id);
  }
  override async login(id: AgentId) {
    if (id === 'skaro') throw new Error('Configure the builtin model connection in Settings');
    return super.login(id);
  }
  override async listModels(id: AgentId, cwd: string): Promise<AgentModel[]> {
    if (id !== 'skaro') return super.listModels(id, cwd);
    const state = this.builtin.store.read();
    const result: AgentModel[] = [];
    for (const connection of state.connections) {
      const routes = state.routes.filter((route) => route.connectionId === connection.id);
      if (!routes.length) continue;
      const catalog = await this.builtin.catalog.read(connection.id, connection.revision);
      for (const route of routes) {
        const metadata = catalog.models.find((model) => model.id === route.modelId);
        if (!metadata) continue;
        const effort = route.parameters[effortParameter(connection.connector)];
        result.push({
          id: route.id,
          name: metadata.name,
          description: `${connection.id} · ${route.modelId}`,
          isDefault: false,
          efforts:
            typeof effort === 'string' &&
            catalogEfforts(connection.connector, metadata).includes(effort)
              ? [{ id: effort }]
              : [],
          ...(typeof effort === 'string' ? { defaultEffort: effort } : {}),
          // The current owner-input formatter admits text; advertised vision is not runtime support.
          images: false,
        });
      }
    }
    return result;
  }
  override async userConfig(id: AgentId, cwd: string): Promise<AgentUserConfig> {
    if (id !== 'skaro') return super.userConfig(id, cwd);
    return { dir: this.dataDir, mcp: [], skills: 0, hooks: 0 };
  }
  override async configDir(id: AgentId) {
    return id === 'skaro' ? this.dataDir : super.configDir(id);
  }
  override async listCommands(id: AgentId, cwd: string) {
    return id === 'skaro' ? [] : super.listCommands(id, cwd);
  }
}
