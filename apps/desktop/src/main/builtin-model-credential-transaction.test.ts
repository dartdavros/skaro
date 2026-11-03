import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { DEFAULT_UPSTREAM_POLICY, type Connection } from '@skaro/timeline';
import { BuiltinModelConfigurationStore } from './builtin-model-configuration';
import { credentialRecoveryDecision } from './builtin-credential-recovery';

const directories: string[] = [];
const handles: AppDb[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'skaro-credential-transaction-'));
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith('skaro-credential-transaction-')
  )
    throw new Error('Unexpected verification directory');
  directories.push(directory);
  const file = join(directory, 'metadata.sqlite');
  const db = AppDb.open(file),
    second = AppDb.open(file);
  handles.push(db, second);
  const connection: Connection = {
    id: 'explicit-connection',
    revision: 1,
    connector: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1',
    apiProfile: { id: 'openrouter.chat-completions', revision: 1 },
    credential: { id: randomUUID(), revision: 1 },
    settings: {},
    routing: DEFAULT_UPSTREAM_POLICY,
  };
  const next = {
    binding: { connectionId: connection.id, connectionRevision: 1, endpoint: connection.endpoint },
    reference: connection.credential,
  };
  return {
    db,
    second,
    connection,
    next,
    store: new BuiltinModelConfigurationStore(db),
    other: new BuiltinModelConfigurationStore(second),
  };
}

it('persists a metadata-only intent before credential import and recovers an unchanged vault by cancelling it', async () => {
  // Pure transaction metadata, not a real/pretend credential, API response or model availability.
  const { store, other, connection, next } = await setup();
  const pending = store.prepareCredential(0, {
    connectionId: connection.id,
    previous: null,
    next,
    choices: { connections: [connection], routes: [] },
  });
  expect(other.pendingCredential()).toEqual(pending);
  expect(() => other.read()).toThrow('recovery');
  expect(() => other.update(1, { connections: [], routes: [] })).toThrow('recovery');
  expect(credentialRecoveryDecision(pending, undefined)).toBe('cancel');
  expect(() =>
    credentialRecoveryDecision(pending, { ...next, reference: { id: randomUUID(), revision: 1 } }),
  ).toThrow('explicit recovery');
  const result = other.finishCredential(pending.id, false);
  expect(result).toMatchObject({ revision: 2, connections: [], routes: [] });
  expect(store.pendingCredential()).toBeUndefined();
});

it('commits the planned target exactly once after a durable vault result and retains revisions across removal', async () => {
  const { store, other, connection, next } = await setup();
  const pending = store.prepareCredential(0, {
    connectionId: connection.id,
    previous: null,
    next,
    choices: { connections: [connection], routes: [] },
  });
  expect(credentialRecoveryDecision(pending, next)).toBe('commit');
  expect(other.finishCredential(pending.id, true)).toMatchObject({
    revision: 2,
    connections: [connection],
  });
  expect(() => store.finishCredential(pending.id, true)).toThrow('identity conflict');
  const deletion = store.prepareCredential(2, {
    connectionId: connection.id,
    previous: next,
    next: null,
    choices: { connections: [], routes: [] },
  });
  expect(credentialRecoveryDecision(deletion, next)).toBe('cancel');
  expect(credentialRecoveryDecision(deletion, undefined)).toBe('commit');
  other.finishCredential(deletion.id, true);
  expect(store.read()).toMatchObject({ revision: 4, connections: [] });
  expect(() => store.update(4, { connections: [connection], routes: [] })).toThrow(
    'next configuration revision',
  );
});
