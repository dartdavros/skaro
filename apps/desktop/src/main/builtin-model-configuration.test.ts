import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, basename, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { DEFAULT_UPSTREAM_POLICY, type Connection, type Route, type Model } from '@skaro/timeline';
import { BuiltinModelConfigurationStore } from './builtin-model-configuration';
import { openRouterBody } from '../../../../packages/agent-runtime/src/models/openrouter-request';

const directories: string[] = [];
const databases: AppDb[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function stores() {
  const directory = await mkdtemp(join(tmpdir(), 'skaro-model-configuration-'));
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith('skaro-model-configuration-')
  )
    throw new Error('Unexpected verification directory');
  directories.push(directory);
  const file = join(directory, 'configuration.sqlite');
  const first = AppDb.open(file),
    second = AppDb.open(file);
  databases.push(first, second);
  return {
    first,
    second,
    file,
    store: new BuiltinModelConfigurationStore(first),
    other: new BuiltinModelConfigurationStore(second),
  };
}
// Pure metadata inputs, not imported credentials, a provider catalog or an available model claim.
const connection = (id = 'first'): Connection => ({
  id,
  revision: 1,
  connector: 'openrouter',
  endpoint: 'https://openrouter.ai/api/v1',
  apiProfile: { id: 'openrouter.chat-completions', revision: 1 },
  credential: { id: randomUUID(), revision: 1 },
  settings: {},
  routing: DEFAULT_UPSTREAM_POLICY,
});
const route = (connectionId = 'first'): Route => ({
  id: 'selected',
  revision: 1,
  connectionId,
  modelId: 'explicit-model-id',
  parameters: { max_tokens: 512 },
  upstream: DEFAULT_UPSTREAM_POLICY,
});

it('persists isolated connections atomically, rejects stale writers and requires current catalog availability', async () => {
  const { store, other, first } = await stores();
  const choices = { connections: [connection(), connection('second')], routes: [route()] };
  const saved = store.update(0, choices);
  expect(saved.revision).toBe(1);
  expect(other.read()).toEqual(saved);
  expect(() => other.update(0, choices)).toThrow('revision conflict');
  const changed = {
    ...choices,
    routes: [{ ...choices.routes[0]!, revision: 2, connectionId: 'second' }],
  };
  const next = other.update(1, changed);
  expect(next.revision).toBe(2);
  expect(store.read().routes[0]?.connectionId).toBe('second');
  const metadata: Model = {
    connectionId: 'second',
    id: 'explicit-model-id',
    manufacturer: null,
    family: null,
    capabilities: {
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
    },
  };
  expect(() => store.snapshot('selected', [{ ...metadata, connectionId: 'first' }])).toThrow(
    'Unknown or ambiguous model',
  );
  const snapshot = store.snapshot('selected', [metadata]);
  expect(snapshot.connectionId).toBe('second');
  expect(snapshot).not.toHaveProperty('credential');
  expect(
    openRouterBody({
      route: snapshot,
      price: { prompt: 0.5, completion: 2 },
      messages: [{ role: 'user', content: 'Pure request formatting contract' }],
    }),
  ).toMatchObject({
    model: 'explicit-model-id',
    max_tokens: 512,
    stream: true,
    provider: { allow_fallbacks: false, require_parameters: true, data_collection: 'deny' },
  });
  expect(() => store.snapshot('selected', [])).toThrow('Unknown or ambiguous model');
  expect(store.read()).toEqual(next);
  expect(new BuiltinModelConfigurationStore(first).read()).toEqual(next);
  expect(() =>
    store.update(2, {
      ...changed,
      routes: [{ ...changed.routes[0]!, parameters: { max_tokens: 1024 } }],
    }),
  ).toThrow('next configuration revision');
  expect(store.read()).toEqual(next);
  const reference = next.connections.find((entry) => entry.id === 'second')!.credential;
  expect(() => store.admit(snapshot, { id: randomUUID(), revision: 1 })).toThrow(
    'no longer current',
  );
  const lease = store.admit(snapshot, reference);
  store.update(2, { connections: next.connections, routes: next.routes });
  expect(lease.signal.aborted).toBe(false);
  other.update(3, {
    connections: next.connections,
    routes: [{ ...next.routes[0]!, revision: 3, parameters: { max_tokens: 1024 } }],
  });
  expect(() => lease.requireCurrent()).toThrow('no longer current');
  expect(lease.signal.aborted).toBe(true);
  const current = store.snapshot('selected', [metadata]);
  const changedCredential = store.admit(current, reference);
  const choicesNow = store.read();
  store.update(4, {
    connections: choicesNow.connections.map((entry) =>
      entry.id === 'second'
        ? { ...entry, revision: 2, credential: { ...entry.credential, revision: 2 } }
        : entry,
    ),
    routes: choicesNow.routes,
  });
  expect(changedCredential.signal.aborted).toBe(true);
});

it('retains deleted identity revisions and refuses secrets, unsupported parameters and widened routing before writing', async () => {
  const { store } = await stores();
  const item = connection();
  store.update(0, { connections: [item], routes: [route()] });
  expect(() => store.update(1, { connections: [], routes: [route()] })).toThrow('no connection');
  expect(() =>
    store.update(1, {
      connections: [{ ...item, revision: 2, settings: { authorization: 'not-a-credential' } }],
      routes: [route()],
    }),
  ).toThrow('Invalid builtin');
  expect(() =>
    store.update(1, {
      connections: [item],
      routes: [{ ...route(), revision: 2, parameters: { api_key: 'not-a-credential' } }],
    }),
  ).toThrow('model parameters');
  expect(() =>
    store.update(1, {
      connections: [item],
      routes: [
        { ...route(), revision: 2, upstream: { ...DEFAULT_UPSTREAM_POLICY, allowFallback: true } },
      ],
    }),
  ).toThrow('widens');
  expect(store.read().revision).toBe(1);
  expect(() =>
    store.update(1, {
      connections: [
        { ...item, revision: 2, endpoint: 'https://openrouter.ai/api/v1?api_key=not-a-credential' },
      ],
      routes: [route()],
    }),
  ).toThrow('without credentials');
  store.update(1, { connections: [], routes: [] });
  expect(() => store.update(2, { connections: [item], routes: [route()] })).toThrow(
    'next configuration revision',
  );
  const recreated = store.update(2, {
    connections: [{ ...item, revision: 2 }],
    routes: [{ ...route(), revision: 2 }],
  });
  expect(recreated.connections[0]?.revision).toBe(2);
  expect(recreated.routes[0]?.revision).toBe(2);
});

it('fails closed on stored corruption and unknown schema without replacing the original setting', async () => {
  const { store, first, file } = await stores();
  first.setSetting('builtin.model-configuration', { schema: 999 });
  expect(() => store.read()).toThrow('unsupported');
  expect(() => store.update(0, { connections: [], routes: [] })).toThrow('unsupported');
  expect(first.getSetting('builtin.model-configuration', null)).toEqual({ schema: 999 });
  const raw = new DatabaseSync(file);
  try {
    raw
      .prepare('UPDATE settings SET value=? WHERE key=?')
      .run('{broken', 'builtin.model-configuration');
  } finally {
    raw.close();
  }
  expect(() => store.read()).toThrow('invalid JSON');
  expect(() => store.update(0, { connections: [], routes: [] })).toThrow('invalid JSON');
  expect(first.getSetting('builtin.model-configuration', 'legacy-fallback')).toBe(
    'legacy-fallback',
  );
});
