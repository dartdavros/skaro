import assert from 'node:assert/strict';
import { join } from 'node:path';
import { AppDb } from '@skaro/core';
import { DEFAULT_UPSTREAM_POLICY, type Connection } from '@skaro/timeline';
import { ModelCredentialVault } from './vault';
import { BuiltinModelConfigurationStore } from '../builtin-model-configuration';
import { BuiltinModelSettingsService } from '../builtin-model-settings-service';

/** OS-storage contract only: noncredential text, no project/UI seed or network/model request. */
export async function verifySettingsStorage(directory: string, storageText: string) {
  const db = AppDb.open(join(directory, 'configuration.sqlite'));
  const store = new BuiltinModelConfigurationStore(db);
  let service = new BuiltinModelSettingsService(store, directory);
  let vault: ModelCredentialVault | undefined;
  const draft: Omit<Connection, 'credential'> = {
    id: 'storage-check',
    revision: 1,
    connector: 'openai',
    endpoint: 'https://api.openai.com/v1',
    apiProfile: { id: 'openai.responses', revision: 1 },
    settings: {},
    routing: DEFAULT_UPSTREAM_POLICY,
  };
  try {
    const before = await service.read();
    assert.equal(before.configuration.revision, 0);
    const existing = before.credentials.find((entry) => entry.binding.connectionId === draft.id)!;
    assert(existing);
    const adopted = await service.saveConnection(0, draft);
    assert.deepEqual(adopted.connections[0]!.credential, existing.reference);
    const rotated = await service.saveConnection(1, { ...draft, revision: 2 }, storageText);
    assert.equal(rotated.revision, 3);
    const current = rotated.connections[0]!;
    assert.equal(current.credential.revision, 2);
    assert.equal(store.pendingCredential(), undefined);
    await service.close();
    const previous = {
      binding: {
        connectionId: current.id,
        connectionRevision: current.revision,
        endpoint: current.endpoint,
      },
      reference: current.credential,
    };
    const next = {
      binding: { ...previous.binding, connectionRevision: 3 },
      reference: { ...previous.reference, revision: 3 },
    };
    const choices = {
      routes: [],
      connections: [{ ...current, revision: 3, credential: next.reference }],
    };
    // Crash before vault mutation: reopening must cancel, not import again.
    store.prepareCredential(3, { connectionId: current.id, previous, next, choices });
    service = new BuiltinModelSettingsService(store, directory);
    const cancelled = await service.read();
    assert.equal(cancelled.configuration.revision, 5);
    assert.deepEqual(cancelled.configuration.connections[0], current);
    await service.close();
    // Crash after the actual encrypted vault commit: metadata-only recovery finishes the same target.
    store.prepareCredential(5, { connectionId: current.id, previous, next, choices });
    vault = new ModelCredentialVault(join(directory, 'credentials'));
    const bytes = Buffer.from(storageText);
    try {
      await vault.replace({
        binding: next.binding,
        expected: previous.reference,
        planned: next.reference,
        secret: bytes,
      });
    } finally {
      bytes.fill(0);
    }
    await vault.close();
    vault = undefined;
    service = new BuiltinModelSettingsService(store, directory);
    const committed = await service.read();
    assert.equal(committed.configuration.revision, 7);
    assert.deepEqual(committed.configuration.connections, choices.connections);
    assert.equal(store.pendingCredential(), undefined);
    await assert.rejects(service.remove(7, 'connection', 'unconfigured-key'), /unavailable/);
    const removed = await service.remove(7, 'connection', current.id);
    assert.deepEqual(removed.connections, []);
    assert.equal(removed.revision, 9);
    assert(
      !(await service.read()).credentials.some(
        (entry) => entry.binding.connectionId === current.id,
      ),
    );
    assert(
      !JSON.stringify(db.getSetting('builtin.model-configuration', null)).includes(storageText),
    );
  } finally {
    await service.close();
    await vault?.close();
    db.close();
  }
}
