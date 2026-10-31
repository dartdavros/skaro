import type { AgentDefinition } from '@skaro/timeline';

/** Validate registrations before creating sessions or exposing installation actions. */
export function validateAgentDefinitions(
  definitions: readonly AgentDefinition[],
): ReadonlyMap<string, AgentDefinition> {
  const result = new Map<string, AgentDefinition>();
  const aliases = new Set<string>();
  const diagnosticKeys = new Set<string>();
  const bundleKeys = new Set<string>();
  const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  for (const definition of definitions) {
    const id = definition.presentation.id;
    if (!/^[a-z][a-z0-9-]*$/.test(id) || result.has(id))
      throw new Error(`Invalid or duplicate agent registration: ${id}`);
    if (
      !definition.presentation.name ||
      !definition.presentation.logo.paths.length ||
      !version.test(definition.pin.version) ||
      !version.test(definition.pin.shownVersion) ||
      !version.test(definition.adapterVersion) ||
      !version.test(definition.package.version) ||
      !(definition.downloadSize > 0) ||
      !definition.questionTool ||
      !definition.capabilities.resume ||
      !definition.capabilities.compact ||
      typeof definition.distribution !== 'function' ||
      typeof definition.loadProjector !== 'function' ||
      typeof definition.loadRuntime !== 'function'
    )
      throw new Error(`Incomplete agent registration: ${id}`);
    if (
      !definition.probeAlias ||
      aliases.has(definition.probeAlias) ||
      !definition.diagnosticVersionKey ||
      diagnosticKeys.has(definition.diagnosticVersionKey) ||
      (definition.legacyBundlePin && bundleKeys.has(definition.legacyBundlePin))
    )
      throw new Error(`Duplicate or missing agent metadata key: ${id}`);
    aliases.add(definition.probeAlias);
    diagnosticKeys.add(definition.diagnosticVersionKey);
    if (definition.legacyBundlePin) bundleKeys.add(definition.legacyBundlePin);
    result.set(id, definition);
  }
  if (!result.size) throw new Error('At least one agent must be registered');
  return result;
}
