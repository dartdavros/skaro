import type { BuiltinTaskSessionPreparer } from './builtin-task-session';
import { requireBuiltinTaskSessionPolicy } from './builtin-task-session-policy';
import { agentRegistration } from '@skaro/agents';
import { parseBuiltinTaskStart, type BuiltinTaskStartOptions } from './builtin-task-start';
import {
  prepareBuiltinSessionModel,
  type BuiltinSessionModelDependencies,
  type BuiltinSessionModelGrant,
} from './builtin-session-models';

type Preparation = Parameters<BuiltinTaskSessionPreparer['prepare']>[0];
export type BuiltinTaskModelGrant = BuiltinSessionModelGrant;
export type BuiltinTaskAuthorization = (input: Preparation) => Promise<BuiltinTaskModelGrant>;
type Dependencies = BuiltinSessionModelDependencies & { authorize: BuiltinTaskAuthorization };

/** Task-specific admission around the common configured model host. */
export class BuiltinTaskModels implements BuiltinTaskSessionPreparer {
  get adapterVersion() {
    const entry = agentRegistration('skaro');
    if (!('adapterVersion' in entry)) throw new Error('Builtin runtime is unavailable');
    return entry.adapterVersion;
  }
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
  }
  async resolveStart(input: BuiltinTaskStartOptions, signal: AbortSignal) {
    signal.throwIfAborted();
    const settings = parseBuiltinTaskStart({ agent: 'skaro', ...input });
    const choices = this.deps.store.read();
    const route = choices.routes.find((route) => route.id === settings.model);
    const connection = choices.connections.find((entry) => entry.id === route?.connectionId);
    if (!route || !connection) throw new Error('Selected builtin task route is unavailable');
    const catalog = await this.deps.catalog.read(connection.id, connection.revision);
    const current = this.deps.store.snapshot(route.id, catalog.models);
    await this.deps.catalog.requireCurrent(current, undefined, signal);
    if (
      settings.effort &&
      current.parameters[
        ['openai', 'deepseek'].includes(current.connector) ? 'reasoning_effort' : 'effort'
      ] !== settings.effort
    )
      throw new Error('Selected task effort differs from the configured route');
    signal.throwIfAborted();
    return settings;
  }
  async prepare(input: Preparation) {
    input.signal.throwIfAborted();
    const grant = await this.deps.authorize(input);
    return prepareBuiltinSessionModel(this.deps, input, grant, (config) =>
      requireBuiltinTaskSessionPolicy(input, config),
    );
  }
}
