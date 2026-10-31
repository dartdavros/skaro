import type { AgentCatalogEntry, AgentId } from './index.ts';

/** Populated from main before mounting the UI. This module has no runtime registry imports. */
let catalog: readonly AgentCatalogEntry[] = [];

export function setAgentCatalog(entries: AgentCatalogEntry[]): void {
  if (!entries.length || new Set(entries.map((entry) => entry.id)).size !== entries.length)
    throw new Error('Invalid agent catalog');
  catalog = structuredClone(entries);
}

export function agentCatalog(): readonly AgentCatalogEntry[] {
  return catalog;
}

export function agentPresentation(id: string): AgentCatalogEntry {
  const entry = catalog.find((agent) => agent.id === id);
  if (!entry) throw new Error(`Unknown agent: ${id}`);
  return entry;
}

export function agentName(id: string): string {
  return catalog.find((agent) => agent.id === id)?.name ?? id;
}

export function defaultAgent(): AgentId {
  const first = catalog[0];
  if (!first) throw new Error('Agent catalog has not been loaded');
  return first.id;
}

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && catalog.some((agent) => agent.id === value);
}
