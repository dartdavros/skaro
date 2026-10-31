import { AGENT_IDS, agentDefinition } from './index.ts';

/** Build metadata comes from the registered packages, with exact SDK pin validation. */
export function adapterVersions(): Record<string, string> {
  const entries = AGENT_IDS.map((id) => {
    const definition = agentDefinition(id);
    const pkg = definition.package;
    if (
      definition.sdkDependency &&
      pkg.dependencies?.[definition.sdkDependency] !== definition.pin.version
    )
      throw new Error(
        `${definition.presentation.name} SDK dependency must exactly match the release pin`,
      );
    return [id, pkg.version];
  });
  return Object.fromEntries(entries);
}
