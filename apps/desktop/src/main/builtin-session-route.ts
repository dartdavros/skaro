import type { BuiltinSessionModelDependencies } from './builtin-session-models';
import { effortParameter } from '@skaro/agent-runtime/catalog-effort';
import { configuredBuiltinConnection } from './builtin-connection-ready';

/** A selection identifies a saved route; provider/model defaults cannot stand in for that route. */
export async function requireBuiltinSessionRoute(
  deps: Pick<BuiltinSessionModelDependencies, 'store' | 'catalog' | 'settings'>,
  selection: { model: string; effort?: string; budgetUsd?: number },
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const choices = deps.store.read();
  const route = choices.routes.find((route) => route.id === selection.model);
  const connection = choices.connections.find((entry) => entry.id === route?.connectionId);
  if (!route || !connection) throw new Error('Selected builtin session route is unavailable');
  if (!configuredBuiltinConnection(await deps.settings.read(), connection.id))
    throw new Error('Selected builtin credential binding is unavailable');
  const catalog = await deps.catalog.read(connection.id, connection.revision);
  const current = deps.store.snapshot(route.id, catalog.models);
  if (selection.budgetUsd !== undefined) {
    const model = catalog.models.find((entry) => entry.id === current.modelId);
    if (
      current.connector !== 'openrouter' ||
      !model ||
      Object.values(model.pricing).some((price) => price === null)
    )
      throw new Error('A USD cap requires complete enforceable provider price ceilings');
  }
  await deps.catalog.requireCurrent(current, undefined, signal);
  if (
    selection.effort &&
    current.parameters[effortParameter(current.connector)] !== selection.effort
  )
    throw new Error('Selected session effort differs from the configured route');
  signal.throwIfAborted();
}
