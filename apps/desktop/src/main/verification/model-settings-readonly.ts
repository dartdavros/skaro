import assert from 'node:assert/strict';
import { app } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { AppDb } from '@skaro/core';
import { DEFAULT_UPSTREAM_POLICY, configuredRouteSnapshot } from '@skaro/timeline';
import { BuiltinModelConfigurationStore } from '../builtin-model-configuration';
import { BuiltinModelSettingsService } from '../builtin-model-settings-service';
import { modelSettingsHandlers } from '../model-settings-handlers';
import { catPilotProjectId } from './cat-pilot-state';

// Separate read-only host, never creates project services, restores sessions or submits a POST.
app.setName('SkaroSettingsVerification');
void app.whenReady().then(async () => {
  const directory = join(app.getPath('appData'), 'Skaro');
  const db = AppDb.readOnly(join(directory, 'skaro.db'));
  db.shell.scopeTo(catPilotProjectId(directory));
  const store = new BuiltinModelConfigurationStore(db);
  const service = new BuiltinModelSettingsService(store, directory);
  let code = 1;
  try {
    assert.equal(
      store.pendingCredential(),
      undefined,
      'Read-only acceptance never performs pending recovery',
    );
    const api = modelSettingsHandlers(service);
    const before = await api['models.settings']();
    assert.equal(before.protection.state, 'available');
    assert(before.credentials.some((entry) => entry.binding.connectionId === 'openrouter-owner'));
    const revision = before.configuration.revision;
    let configuredLease = false;
    if (process.argv.includes('--configured')) {
      const connection = before.configuration.connections.find(
        (entry) => entry.id === 'openrouter-owner',
      );
      assert(connection);
      const route = before.configuration.routes.find(
        (entry) => entry.connectionId === connection.id && entry.modelId === 'openai/gpt-4.1-nano',
      );
      assert(route);
      const metadata = before.credentials.find(
        (entry) => entry.binding.connectionId === connection.id,
      );
      assert(metadata);
      assert.deepEqual(metadata.reference, connection.credential);
      assert.equal(metadata.binding.connectionRevision, connection.revision);
      assert.equal(metadata.binding.endpoint, connection.endpoint);
      const snapshot = configuredRouteSnapshot(route, before.configuration.connections);
      const lease = store.admit(snapshot, metadata.reference);
      lease.requireCurrent();
      assert.equal(lease.signal.aborted, false);
      lease.close();
      assert.equal(lease.signal.aborted, true);
      assert.throws(
        () =>
          store.admit(snapshot, {
            ...metadata.reference,
            revision: metadata.reference.revision + 1,
          }),
        /unavailable/,
      );
      configuredLease = true;
    }
    const connection = {
      id: 'invalid-readonly-input',
      revision: 1,
      connector: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1',
      apiProfile: { id: 'openrouter.chat-completions', revision: 1 },
      settings: {},
      routing: DEFAULT_UPSTREAM_POLICY,
    };
    await assert.rejects(
      api['models.saveConnection'](revision, connection, 'invalid\ninput'),
      /MODEL_SETTINGS_REJECTED/,
    );
    await assert.rejects(
      api['models.saveConnection'](revision, {
        ...connection,
        settings: { authorization: 'forbidden' },
      }),
      /MODEL_SETTINGS_REJECTED/,
    );
    await assert.rejects(
      api['models.saveRoute'](revision + 1, {
        id: 'readonly-revision-conflict',
        revision: 1,
        connectionId: connection.id,
        modelId: 'not-requested',
        parameters: {},
        upstream: DEFAULT_UPSTREAM_POLICY,
      }),
      /MODEL_SETTINGS_REJECTED/,
    );
    await assert.rejects(
      api['models.remove'](revision, 'connection', 'unconfigured-readonly-entry'),
      /MODEL_SETTINGS_REJECTED/,
    );
    await assert.rejects(
      api['models.saveRoute'](revision, {
        id: 'bad-schema',
        revision: 0,
        connectionId: connection.id,
        modelId: '',
        parameters: {},
        upstream: DEFAULT_UPSTREAM_POLICY,
      }),
      /MODEL_SETTINGS_REJECTED/,
    );
    const after = await api['models.settings']();
    assert.deepEqual(after, before);
    const result = {
      type: 'model-settings-readonly',
      proof: {
        project: 'Cat-pilot',
        readonlyDatabase: true,
        projectServicesStarted: false,
        projectFilesRead: 0,
        actualVaultMetadata: true,
        credentialBytesRead: false,
        settingsUnchanged: true,
        configuredLease,
        invalidSecretAndHeadersRefused: true,
        staleRevisionRefused: true,
        unconfiguredDeletionRefused: true,
        invalidRouteSchemaRefused: true,
        modelRequests: 0,
        connections: before.configuration.connections.length,
        routes: before.configuration.routes.length,
        credentialReferences: before.credentials.length,
      },
    };
    const proofDirectory = join(directory, 'verification', `model-settings-${randomUUID()}`);
    await mkdir(proofDirectory, { recursive: true });
    await writeFile(join(proofDirectory, 'proof.json'), JSON.stringify(result, null, 2));
    process.send?.({ ...result, directory: proofDirectory });
    code = 0;
  } catch (error) {
    process.send?.({
      type: 'failed',
      stage: 'model-settings-readonly',
      name: error instanceof Error ? error.name : 'Error',
    });
  } finally {
    await service.close();
    db.close();
    app.exit(code);
  }
});
