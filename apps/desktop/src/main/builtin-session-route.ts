import type { BuiltinSessionModelDependencies } from './builtin-session-models';

/** A selection identifies a saved route; provider/model defaults cannot stand in for that route. */
export async function requireBuiltinSessionRoute(
  deps: Pick<BuiltinSessionModelDependencies, 'store' | 'catalog'>,
  selection: { model: string; effort?: string },
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const choices = deps.store.read();
  const route = choices.routes.find((route) => route.id === selection.model);
  const connection = choices.connections.find((entry) => entry.id === route?.connectionId);
  if (!route || !connection) throw new Error('Selected builtin session route is unavailable');
  const catalog = await deps.catalog.read(connection.id, connection.revision);
  const current = deps.store.snapshot(route.id, catalog.models);
  await deps.catalog.requireCurrent(current, undefined, signal);
  if (
    selection.effort &&
    current.parameters[
      ['openai', 'deepseek'].includes(current.connector) ? 'reasoning_effort' : 'effort'
    ] !== selection.effort
  )
    throw new Error('Selected session effort differs from the configured route');
  signal.throwIfAborted();
}
