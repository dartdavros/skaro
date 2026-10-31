import type { AgentDefinition, AgentHost, AgentPresentation } from '@skaro/timeline';
import { validateAgentDefinitions } from './validation.ts';
import { registrations } from './registrations.ts';

export type AgentId = (typeof registrations)[number]['presentation']['id'];
export type ProbeAgent = (typeof registrations)[number]['probeAlias'];
export type DiagnosticVersionKey = (typeof registrations)[number]['diagnosticVersionKey'];
export type AgentCatalogEntry = AgentPresentation & { id: AgentId };
export type LegacyBundlePins = {
  [
    D in (typeof registrations)[number] as D extends { legacyBundlePin: string }
      ? D['legacyBundlePin']
      : never
  ]: string;
};

const definitions = validateAgentDefinitions(registrations);
export const AGENT_IDS = registrations.map((agent) => agent.presentation.id);
/** Updater has historically displayed Codex first; preserve that independent ordering. */
export const RELEASE_AGENT_IDS = [...registrations]
  .sort((a, b) => a.releaseOrder - b.releaseOrder)
  .map((agent) => agent.presentation.id);
export const DEFAULT_AGENT = AGENT_IDS[0]!;
export const AGENT_PINS = Object.fromEntries(
  registrations.map((agent) => [agent.presentation.id, agent.pin.version]),
) as Record<AgentId, string>;

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && definitions.has(value);
}

export function requireAgentId(value: unknown): AgentId {
  if (!isAgentId(value)) throw new Error(`Unknown agent: ${String(value)}`);
  return value;
}

export function agentDefinition(id: string): AgentDefinition {
  const definition = definitions.get(id);
  if (!definition) throw new Error(`Unknown agent: ${id}`);
  return definition;
}

export function agentCatalog(): AgentCatalogEntry[] {
  return registrations.map((agent) => structuredClone(agent.presentation));
}

/** Version-independent projectors are also used for recorded native streams. */
export async function projectorFor(id: string, adapterVersion?: string) {
  const definition = agentDefinition(id);
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

export const PROBE_AGENTS = registrations.map((agent) => agent.probeAlias);
export function probeAgentId(alias: string): AgentId {
  const agent = registrations.find(
    (agent) => agent.probeAlias === alias || agent.presentation.id === alias,
  );
  if (!agent) throw new Error(`Unknown agent: ${alias}`);
  return agent.presentation.id;
}
export const diagnosticVersions = () =>
  Object.fromEntries(
    registrations.map((agent) => [agent.diagnosticVersionKey, agent.pin.version]),
  ) as Record<DiagnosticVersionKey, string>;
