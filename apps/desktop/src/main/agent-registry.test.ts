import { describe, expect, it } from 'vitest';
import { agentPackage } from '@skaro/core';
import {
  AGENT_IDS,
  RELEASE_AGENT_IDS,
  DEFAULT_AGENT,
  agentCatalog,
  agentDefinition,
  isAgentId,
  requireAgentId,
  projectorFor,
  legacyBundlePins,
  matchesLegacyBundlePins,
} from '@skaro/agents';
import { validateAgentDefinitions } from '../../../../packages/agents/src/validation.ts';
import {
  setAgentCatalog,
  agentCatalog as browserCatalog,
  agentName,
  defaultAgent,
} from '@skaro/agents/catalog';

describe('registered agents', () => {
  it('preserves the existing catalog, versions and distribution on all six platforms', () => {
    expect(AGENT_IDS).toEqual(['claude-code', 'codex']);
    expect(DEFAULT_AGENT).toBe('claude-code');
    expect(RELEASE_AGENT_IDS).toEqual(['codex', 'claude-code']);
    expect(agentCatalog().map(({ name, boardLogoSize }) => ({ name, boardLogoSize }))).toEqual([
      { name: 'Claude Code', boardLogoSize: 17 },
      { name: 'Codex', boardLogoSize: 16 },
    ]);
    for (const os of ['win32', 'darwin', 'linux'] as const)
      for (const arch of ['x64', 'arm64'])
        for (const id of AGENT_IDS) {
          const definition = agentDefinition(id);
          const pkg = agentPackage(id, { os, arch });
          expect(pkg.agent).toBe(id);
          expect(pkg.version).toBe(definition.pin.version);
          expect(pkg.shownVersion).toBe(definition.pin.shownVersion);
          expect(pkg.binary.endsWith('.exe')).toBe(os === 'win32');
        }
    expect(agentPackage('claude-code', { os: 'linux', arch: 'arm64', musl: true }).name).toBe(
      '@anthropic-ai/claude-agent-sdk-linux-arm64-musl',
    );
  });

  it('rejects duplicate registrations and unknown agents instead of falling back to Claude', async () => {
    const definition = agentDefinition(DEFAULT_AGENT);
    expect(() => validateAgentDefinitions([definition, definition])).toThrow('duplicate');
    expect(() => validateAgentDefinitions([])).toThrow('At least one');
    expect(isAgentId('unknown-agent')).toBe(false);
    expect(() => requireAgentId('unknown-agent')).toThrow('Unknown agent');
    await expect(projectorFor('unknown-agent')).rejects.toThrow('Unknown agent');
    expect(() => agentPackage('codex', { os: 'freebsd', arch: 'x64' })).toThrow('not available');
  });

  it('transfers presentation data to the browser without runtime factories or mutable sharing', () => {
    const data = agentCatalog();
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    setAgentCatalog(data);
    data[0]!.name = 'changed';
    expect(defaultAgent()).toBe(DEFAULT_AGENT);
    expect(agentName(DEFAULT_AGENT)).toBe('Claude Code');
    expect(browserCatalog()).toEqual(agentCatalog());
    expect(agentName('unknown-agent')).toBe('unknown-agent');
    expect(Object.keys(browserCatalog()[0]!)).toEqual(['id', 'name', 'boardLogoSize', 'logo']);
  });

  it('retains the manifest v1 SDK alias and rejects mismatched versions', () => {
    const pins = Object.fromEntries(AGENT_IDS.map((id) => [id, agentDefinition(id).pin]));
    const aliases = legacyBundlePins(pins);
    expect(aliases).toEqual({ claudeSdk: '0.3.285' });
    expect(matchesLegacyBundlePins(aliases, pins)).toBe(true);
    expect(matchesLegacyBundlePins({}, pins)).toBe(false);
    expect(matchesLegacyBundlePins({ claudeSdk: '0.0.0' }, pins)).toBe(false);
  });
});
