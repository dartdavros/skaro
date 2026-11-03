import type {
  AgentDefinition,
  AgentHost,
  AgentPresentation,
  AgentRegistration,
  BuiltinSessionOptions,
} from '@skaro/timeline';
import { validateAgentDefinitions, validateAgentRegistrations } from './validation.ts';
import { registrations, activeRegistrations } from './registrations.ts';

export type ManagedAgentId = (typeof activeRegistrations)[number]['presentation']['id'];
export type AgentId = ManagedAgentId | 'skaro';
export type ProbeAgent = (typeof activeRegistrations)[number]['probeAlias'];
export type DiagnosticVersionKey = (typeof activeRegistrations)[number]['diagnosticVersionKey'];
export type AgentCatalogEntry = AgentPresentation & { id: AgentId; newSettingsDefault?: boolean };
export {
  newSettingsAgent,
  BUILTIN_DEFAULT_RELEASED,
  BUILTIN_PRODUCT_RELEASED,
} from './builtin-default.ts';
export type LegacyBundlePins = {
  [
    D in (typeof activeRegistrations)[number] as D extends { legacyBundlePin: string }
      ? D['legacyBundlePin']
      : never
  ]: string;
};

const definitions = validateAgentDefinitions(activeRegistrations);
const registrationMap = validateAgentRegistrations(registrations);
export const REGISTERED_AGENT_IDS = [...registrationMap.keys()];

export function agentRegistration(id: string): AgentRegistration {
  const entry = registrationMap.get(id);
  if (!entry) throw new Error(`Unknown agent: ${id}`);
  return entry;
}

export const AGENT_IDS = activeRegistrations.map((agent) => agent.presentation.id);
/** Updater has historically displayed Codex first; preserve that independent ordering. */
export const RELEASE_AGENT_IDS = [...activeRegistrations]
  .sort((a, b) => a.releaseOrder - b.releaseOrder)
  .map((agent) => agent.presentation.id);
export const DEFAULT_AGENT = AGENT_IDS[0]!;
export const AGENT_PINS = Object.fromEntries(
  activeRegistrations.map((agent) => [agent.presentation.id, agent.delivery.pin.version]),
) as Record<ManagedAgentId, string>;

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && (definitions.has(value) || value === 'skaro');
}
export function isManagedAgentId(value: unknown): value is ManagedAgentId {
  return typeof value === 'string' && definitions.has(value);
}

export function requireAgentId(value: unknown): AgentId {
  if (!isAgentId(value)) {
    if (typeof value === 'string') agentDefinition(value);
    throw new Error(`Unknown agent: ${String(value)}`);
  }
  return value;
}

export function agentDefinition(id: string): AgentDefinition {
  const registration = agentRegistration(id);
  if ('stage' in registration)
    throw new Error(`Agent ${id} unavailable: ${registration.unavailableReason}`);
  const definition = definitions.get(id);
  if (!definition) throw new Error(`Unknown agent: ${id}`);
  return definition;
}

export function agentCatalog(): AgentCatalogEntry[] {
  return activeRegistrations.map((agent) => structuredClone(agent.presentation));
}

/** Version-independent projectors are also used for recorded native streams. */
export async function projectorFor(id: string, adapterVersion?: string) {
  const definition = agentRegistration(id);
  if (!('loadProjector' in definition))
    throw new Error(`Agent ${id} unavailable: ${definition.unavailableReason}`);
  const create = await definition.loadProjector();
  return (context: Parameters<typeof create>[0], emit: Parameters<typeof create>[1]) =>
    create(context, emit, adapterVersion);
}

export async function createAgentAdapter(id: string, host: AgentHost) {
  const runtime = await agentDefinition(id).loadRuntime();
  const adapter = runtime.createAdapter(host);
  if (adapter.id !== id) throw new Error(`Agent runtime ID mismatch: ${id}`);
  return adapter;
}

/** Lifecycle-only entry; the unfinished agent remains outside the product catalog. */
export async function startBundledSession(id: string, options: BuiltinSessionOptions) {
  const entry = agentRegistration(id);
  if (!('stage' in entry) || entry.stage !== 'runtime-core')
    throw new Error(`Agent has no bundled session runtime: ${id}`);
  return (await entry.loadSessionRuntime()).start(options);
}

export const instructionFiles = () => [
  ...new Set([...definitions.values()].flatMap((agent) => [...agent.instructionFiles])),
];

export const legacyBundlePins = (pins: Record<string, { version: string }>) =>
  Object.fromEntries(
    [...definitions.values()].flatMap((agent) =>
      agent.legacyBundlePin ? [[agent.legacyBundlePin, pins[agent.presentation.id]?.version]] : [],
    ),
  ) as LegacyBundlePins;

export function matchesLegacyBundlePins(
  value: object,
  pins: Record<string, { version: string }>,
): boolean {
  const record = value as Record<string, unknown>;
  return Object.entries(legacyBundlePins(pins)).every(([key, version]) => record[key] === version);
}

export const PROBE_AGENTS = activeRegistrations.map((agent) => agent.probeAlias);
export function probeAgentId(alias: string): AgentId {
  const agent = activeRegistrations.find(
    (agent) => agent.probeAlias === alias || agent.presentation.id === alias,
  );
  if (!agent) throw new Error(`Unknown agent: ${alias}`);
  return agent.presentation.id;
}
export const diagnosticVersions = () =>
  Object.fromEntries(
    activeRegistrations.map((agent) => [agent.diagnosticVersionKey, agent.delivery.pin.version]),
  ) as Record<DiagnosticVersionKey, string>;
