import assert from 'node:assert/strict';
import { app, type Session } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { AppDb } from '@skaro/core';
import { BuiltinModelConfigurationStore } from '../builtin-model-configuration';
import { BuiltinModelCatalog } from '../builtin-model-catalog';
import { modelCatalogHandlers } from '../model-catalog-handlers';
import { catPilotProjectId } from './cat-pilot-state';
import { liveProxyEnvironment } from '../credentials/live-proxy';
import { requireOpenRouterCatalogRoute } from '@skaro/agent-runtime';
import { openRouterEfforts } from '@skaro/agent-runtime/openrouter-effort';

// Genuine public metadata GET through the owner VPN. No vault/project services/model request.
app.setName('SkaroCatalogVerification');
void app.whenReady().then(async () => {
  const data = join(app.getPath('appData'), 'Skaro');
  const db = AppDb.readOnly(join(data, 'skaro.db'));
  db.shell.scopeTo(catPilotProjectId(data));
  const store = new BuiltinModelConfigurationStore(db);
  const proxy = liveProxyEnvironment(process.env['SKARO_VERIFY_PROXY']).HTTPS_PROXY;
  const service = new BuiltinModelCatalog(store, { verification: true, proxy });
  let requests = 0;
  let authorizationHeader = false;
  const sessions: Session[] = [];
  app.on('session-created', (network) => {
    sessions.push(network);
    network.webRequest.onBeforeSendHeaders(
      { urls: ['https://openrouter.ai/api/v1/models'] },
      (details, callback) => {
        requests++;
        authorizationHeader ||= Object.keys(details.requestHeaders).some(
          (name) => name.toLowerCase() === 'authorization',
        );
        callback({ cancel: details.method !== 'GET' || authorizationHeader });
      },
    );
  });
  let code = 1;
  try {
    const before = store.read();
    const connection = before.connections.find((entry) => entry.id === 'openrouter-owner');
    assert(connection);
    const api = modelCatalogHandlers(service);
    await assert.rejects(api['models.catalog'](connection.id, 0), /MODEL_CATALOG_UNAVAILABLE/);
    await assert.rejects(
      api['models.catalog'](connection.id, connection.revision + 1),
      /MODEL_CATALOG_UNAVAILABLE/,
    );
    assert.equal(requests, 0);
    const [first, same] = await Promise.all([
      api['models.catalog'](connection.id, connection.revision),
      api['models.catalog'](connection.id, connection.revision),
    ]);
    assert.deepEqual(first, same);
    assert(first.models.length > 0);
    const target = first.models.find((entry) => entry.id === 'openai/gpt-4.1-nano');
    assert(target);
    assert.equal(target.capabilities.evidence, 'catalog');
    assert.equal(target.capabilities.tools, 'supported');
    assert.equal(target.manufacturer, null);
    assert.equal(target.family, null);
    assert(first.models.every((entry) => entry.connectionId === connection.id));
    const effortModels = first.models.filter((model) => openRouterEfforts(model).length > 0);
    for (const model of effortModels)
      if (model.reasoning?.mandatory === true) assert(!openRouterEfforts(model).includes('none'));
    assert.equal(new Set(first.models.map((entry) => entry.id)).size, first.models.length);
    assert.equal(requests, 1);
    const selected = before.routes.find(
      (route) => route.connectionId === connection.id && route.modelId === target.id,
    );
    assert(selected);
    const route = store.snapshot(selected.id, first.models);
    await service.requireCurrent(route, undefined, new AbortController().signal);
    await assert.rejects(
      service.requireCurrent(
        { ...route, routeRevision: route.routeRevision + 1 },
        undefined,
        new AbortController().signal,
      ),
      /no longer current/,
    );
    assert.throws(
      () =>
        requireOpenRouterCatalogRoute({ ...route, modelId: 'absent-catalog-model' }, first.models),
      /absent/,
    );
    if (target.capabilities.reasoning === 'unknown')
      assert.throws(
        () =>
          requireOpenRouterCatalogRoute(
            { ...route, parameters: { ...route.parameters, reasoning_effort: 'low' } },
            first.models,
          ),
        /not advertised/,
      );
    assert.equal(requests, 1);
    const cached = await api['models.catalog'](connection.id, connection.revision);
    assert.deepEqual(cached, first);
    assert.equal(requests, 1);
    const refreshed = await api['models.catalog'](connection.id, connection.revision, true);
    assert(refreshed.fetchedAt >= first.fetchedAt);
    assert.equal(requests, 2);
    const resolutions = await Promise.all(
      sessions.map((network) => network.resolveProxy(connection.endpoint)),
    );
    assert(resolutions.length > 0);
    assert(resolutions.every((value) => value === 'PROXY 127.0.0.1:10809'));
    assert.equal(authorizationHeader, false);
    assert.deepEqual(store.read(), before);
    await service.close();
    await assert.rejects(
      api['models.catalog'](connection.id, connection.revision),
      /MODEL_CATALOG_UNAVAILABLE/,
    );
    const proof = {
      project: 'Cat-pilot',
      projectServicesStarted: false,
      projectFilesRead: 0,
      readonlyDatabase: true,
      configurationUnchanged: true,
      credentialVaultOpened: false,
      authorizationHeader,
      modelRequests: 0,
      actualPublicMetadataRequests: requests,
      proxy: 'http://127.0.0.1:10809',
      directFallback: false,
      catalogModels: first.models.length,
      advertisedEffortModels: effortModels.length,
      effortMetadataSample: effortModels
        .slice(0, 3)
        .map((model) => ({ id: model.id, levels: openRouterEfforts(model) })),
      dedupAndCache: true,
      exactConnectionScope: true,
      capabilityEvidence: 'catalog',
      configuredModelPresent: true,
      configuredRouteMetadataChecked: true,
      staleRouteRefused: true,
      missingModelRefused: true,
      unadvertisedReasoningRefused: target.capabilities.reasoning === 'unknown',
      staleRevisionRefusedBeforeNetwork: true,
      closedServiceRefused: true,
    };
    const directory = join(data, 'verification', `model-catalog-${randomUUID()}`);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'proof.json'), JSON.stringify(proof, null, 2));
    process.send?.({ type: 'model-catalog', directory, proof });
    code = 0;
  } catch (error) {
    process.send?.({
      type: 'failed',
      stage: 'model-catalog',
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message.slice(0, 240) : 'Unknown catalog failure',
    });
  } finally {
    await service.close();
    db.close();
    app.exit(code);
  }
});
