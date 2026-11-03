import {
  requireBuiltinCompatibility,
  type AgentDefinition,
  type AgentRegistration,
} from '@skaro/timeline';

export function validateAgentRegistrations(
  registrations: readonly AgentRegistration[],
): ReadonlyMap<string, AgentRegistration> {
  const result = new Map<string, AgentRegistration>();
  for (const entry of registrations) {
    const id = 'stage' in entry ? entry.id : entry.presentation.id;
    if (!/^[a-z][a-z0-9-]*$/.test(id) || result.has(id))
      throw new Error(`Invalid or duplicate agent registration: ${id}`);
    if ('stage' in entry) {
      if (
        !['contract-only', 'runtime-core'].includes(entry.stage) ||
        entry.delivery.kind !== 'bundled' ||
        entry.delivery.versioning !== 'with-skaro' ||
        !entry.delivery.runtimePackage ||
        'loadRuntime' in entry ||
        'presentation' in entry ||
        'pin' in entry.delivery ||
        'distribution' in entry.delivery ||
        'downloadSize' in entry.delivery
      )
        throw new Error(`Invalid bundled contract registration: ${id}`);
      requireBuiltinCompatibility(entry.delivery.contracts);
      if (entry.stage === 'runtime-core') {
        if (
          entry.unavailableReason !== 'configured-host-required' ||
          typeof entry.loadSessionRuntime !== 'function' ||
          typeof entry.loadProjector !== 'function' ||
          !/^\d+\.\d+\.\d+$/.test(entry.package.version) ||
          entry.adapterVersion !== entry.package.version
        )
          throw new Error(`Incomplete bundled runtime: ${id}`);
      } else if (entry.unavailableReason !== 'runtime-not-implemented')
        throw new Error(`Invalid reserved bundled runtime: ${id}`);
    }
    result.set(id, entry);
  }
  if (!result.size) throw new Error('At least one agent must be registered');
  return result;
}

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
      definition.delivery.kind !== 'managed-npm' ||
      !definition.presentation.name ||
      !definition.presentation.logo.paths.length ||
      !version.test(definition.delivery.pin.version) ||
      !version.test(definition.delivery.pin.shownVersion) ||
      !version.test(definition.adapterVersion) ||
      !version.test(definition.package.version) ||
      !(definition.delivery.downloadSize > 0) ||
      !definition.questionTool ||
      !definition.capabilities.resume ||
      !definition.capabilities.compact ||
      typeof definition.delivery.distribution !== 'function' ||
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
