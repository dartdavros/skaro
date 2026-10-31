import { describe, expect, it } from 'vitest';
import {
  BUILTIN_API_PROFILES,
  DEFAULT_UPSTREAM_POLICY,
  snapshotRoute,
  requireRouteCapabilities,
  requireImplementedApiProfile,
  validateModelEndpoint,
  type Connection,
  type Model,
  type Route,
  type RouteCapabilities,
  type ApiProfile,
} from '@skaro/timeline';

// Pure contract inputs. No API response, model catalog, server or environment is substituted.
const unknown: RouteCapabilities = {
  tools: 'unknown',
  images: 'unknown',
  reasoning: 'unknown',
  parallelTools: 'unknown',
  cache: 'unknown',
  continuation: 'unknown',
  compaction: 'unknown',
  contextTokens: null,
  outputTokens: null,
  evidence: 'unknown',
};

function connection(id: string, connector = 'anthropic'): Connection {
  const profile = BUILTIN_API_PROFILES.find((entry) => entry.connector === connector)!;
  return {
    id,
    revision: 1,
    connector,
    endpoint: 'https://api.anthropic.com',
    apiProfile: { id: profile.id, revision: profile.revision },
    credential: { id: `${id}-credential`, revision: 1 },
    settings: {},
    routing: { ...DEFAULT_UPSTREAM_POLICY },
  };
}

function model(connectionId: string): Model {
  return {
    connectionId,
    id: 'exact-model-id',
    manufacturer: 'anthropic',
    family: null,
    capabilities: unknown,
  };
}

function route(connectionId: string): Route {
  return {
    id: `${connectionId}-route`,
    revision: 1,
    connectionId,
    modelId: 'exact-model-id',
    parameters: {},
    upstream: { ...DEFAULT_UPSTREAM_POLICY },
  };
}

describe('builtin route contract', () => {
  it('accepts a compatible custom endpoint and an explicit profile without provider switches', () => {
    const custom = connection('custom');
    custom.endpoint = 'https://models.example.org/v1';
    custom.connector = 'additional-connector';
    const profile: ApiProfile = {
      id: 'additional.messages',
      revision: 1,
      connector: custom.connector,
      protocol: 'messages',
      implementation: 'pending',
    };
    custom.apiProfile = { id: profile.id, revision: profile.revision };
    custom.routing = {
      ...custom.routing,
      selection: 'restricted',
      allow: ['approved'],
      allowFallback: true,
    };
    const saved = { ...route(custom.id), upstream: { ...custom.routing } };
    const snapshot = snapshotRoute(saved, [custom], [model(custom.id)], [profile]);
    expect(snapshot.connector).toBe('additional-connector');
    expect(snapshot.endpoint).toBe(custom.endpoint);
    expect(snapshot.upstream.allowFallback).toBe(true);
    expect(() => snapshotRoute(saved, [custom], [model(custom.id)])).toThrow('API profile');
  });

  it('distinguishes two accounts and direct/gateway access independently of model manufacturer', () => {
    const connections = [
      connection('direct'),
      connection('second'),
      connection('gateway', 'openrouter'),
    ];
    connections[2]!.endpoint = 'https://openrouter.ai/api/v1';
    const models = connections.map(({ id }) => model(id));
    const snapshots = connections.map(({ id }) => snapshotRoute(route(id), connections, models));
    expect(new Set(snapshots.map((entry) => entry.connectionId)).size).toBe(3);
    expect(snapshots.map((entry) => entry.connector)).toEqual([
      'anthropic',
      'anthropic',
      'openrouter',
    ]);
    expect(new Set(snapshots.map((entry) => entry.modelId)).size).toBe(1);
    expect(snapshots.every((entry) => !('credential' in entry) && !('settings' in entry))).toBe(
      true,
    );
  });

  it('rejects unknown, mismatched and ambiguous IDs without substitutions', () => {
    const saved = route('direct');
    const direct = connection('direct');
    expect(() => snapshotRoute(saved, [], [model('direct')])).toThrow('connection');
    expect(() => snapshotRoute(saved, [direct, direct], [model('direct')])).toThrow('ambiguous');
    expect(() => snapshotRoute(saved, [direct], [model('gateway')])).toThrow('model');
    expect(() => snapshotRoute(saved, [direct], [model('direct'), model('direct')])).toThrow(
      'ambiguous',
    );
    for (const apiProfile of [
      { id: 'missing', revision: 1 },
      { id: direct.apiProfile.id, revision: 2 },
    ])
      expect(() => snapshotRoute(saved, [{ ...direct, apiProfile }], [model('direct')])).toThrow(
        'API profile',
      );
    expect(() =>
      snapshotRoute(saved, [{ ...direct, connector: 'openai' }], [model('direct')]),
    ).toThrow('API profile');
    expect(() => snapshotRoute({ ...saved, revision: 0 }, [direct], [model('direct')])).toThrow(
      'revision',
    );
  });

  it('preserves immutable request provenance with exact revisions and parameter values', () => {
    const direct = connection('direct');
    const saved = route('direct');
    saved.parameters = { temperature: 0.2 };
    const snapshot = snapshotRoute(saved, [direct], [model('direct')]);
    saved.parameters = { temperature: 0.8 };
    direct.apiProfile.revision = 2;
    expect(snapshot.parameters).toEqual({ temperature: 0.2 });
    expect(snapshot.apiProfile.revision).toBe(1);
    expect(snapshot.connectionRevision).toBe(1);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('rejects policy widening, invalid allowlists and secret-bearing endpoints', () => {
    const direct = connection('direct');
    const saved = route('direct');
    for (const upstream of [
      { ...saved.upstream, allowFallback: true },
      { ...saved.upstream, requireParameters: false },
      { ...saved.upstream, dataCollection: 'allow' as const },
    ])
      expect(() => snapshotRoute({ ...saved, upstream }, [direct], [model('direct')])).toThrow(
        'widens',
      );
    direct.routing = { ...direct.routing, selection: 'restricted', allow: ['approved'] };
    expect(() => snapshotRoute(saved, [direct], [model('direct')])).toThrow('widens');
    const restricted = { ...saved.upstream, selection: 'restricted' as const, allow: ['approved'] };
    expect(
      snapshotRoute({ ...saved, upstream: restricted }, [direct], [model('direct')]).upstream,
    ).toEqual(restricted);
    expect(() =>
      snapshotRoute(
        { ...saved, upstream: { ...restricted, allow: [] } },
        [direct],
        [model('direct')],
      ),
    ).toThrow('Invalid upstream');
    for (const endpoint of [
      'http://api.anthropic.com',
      'https://user:pass@api.anthropic.com',
      'https://api.anthropic.com?key=value',
      'https://api.anthropic.com#value',
    ])
      expect(() => validateModelEndpoint(endpoint)).toThrow('HTTPS');
  });

  it('requires verification on the exact route and fails closed for catalog/unknown capabilities', () => {
    const snapshot = snapshotRoute(route('direct'), [connection('direct')], [model('direct')]);
    const capabilities: RouteCapabilities = {
      ...unknown,
      tools: 'supported',
      continuation: 'native',
      evidence: 'verified',
    };
    expect(() =>
      requireRouteCapabilities(snapshot, { route: snapshot, capabilities }, [
        'tools',
        'continuation',
      ]),
    ).not.toThrow();
    for (const evidence of ['catalog', 'unknown'] as const)
      expect(() =>
        requireRouteCapabilities(
          snapshot,
          { route: snapshot, capabilities: { ...capabilities, evidence } },
          ['tools'],
        ),
      ).toThrow('not verified');
    expect(() =>
      requireRouteCapabilities(snapshot, { route: snapshot, capabilities }, ['images']),
    ).toThrow('images');
    expect(() =>
      requireRouteCapabilities(
        { ...snapshot, routeRevision: 2 },
        { route: snapshot, capabilities },
        ['tools'],
      ),
    ).toThrow('stale');
    expect(() =>
      requireRouteCapabilities(
        { ...snapshot, parameters: { temperature: 0.5 } },
        { route: snapshot, capabilities },
        ['tools'],
      ),
    ).toThrow('stale');
  });

  it('keeps the four initial profiles unimplemented until real connector verification', () => {
    expect(BUILTIN_API_PROFILES.map((entry) => entry.protocol)).toEqual([
      'responses',
      'messages',
      'chat-completions',
      'chat-completions',
    ]);
    for (const profile of BUILTIN_API_PROFILES)
      expect(() => requireImplementedApiProfile(profile)).toThrow('not implemented');
  });
});
