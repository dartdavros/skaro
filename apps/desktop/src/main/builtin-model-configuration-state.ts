import { isDeepStrictEqual } from 'node:util';
import {
  parseBuiltinModelChoices,
  parseBuiltinModelConfiguration,
  type BuiltinModelConfigurationState,
} from '@skaro/agent-runtime';
import type { BuiltinModelConfiguration } from '@skaro/timeline';

export const MODEL_CONFIGURATION_KEY = 'builtin.model-configuration';
export const emptyModelConfiguration = (): BuiltinModelConfigurationState => ({
  schema: 1,
  revision: 0,
  connections: [],
  routes: [],
  connectionVersions: [],
  routeVersions: [],
});
export const projectModelConfiguration = (
  state: BuiltinModelConfigurationState,
): BuiltinModelConfiguration =>
  structuredClone({
    schema: state.schema,
    revision: state.revision,
    connections: state.connections,
    routes: state.routes,
  });

/** Same validation and revision history for ordinary updates and durable credential transactions. */
export function nextModelConfiguration(
  state: BuiltinModelConfigurationState,
  proposed: Pick<BuiltinModelConfiguration, 'connections' | 'routes'>,
  revision = state.revision + 1,
) {
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
  return parseBuiltinModelConfiguration({
    schema: 1,
    revision,
    ...value,
    connectionVersions: versions(state.connections, value.connections, state.connectionVersions),
    routeVersions: versions(state.routes, value.routes, state.routeVersions),
  });
}
