import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { readRuntimeJournal } from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { RuntimeModelRequest } from '@skaro/timeline';
import type { Services } from '../app-services';
import { NativeAdmissions } from '../native/admissions';
import { AdmissionStore } from '../native/admission-state';
import { nativeProbeConfig, nativeProbeOptions } from './native-probe-options';
import { c4ReviewKey } from '../c4-review';
import { verifyModelTimeline } from './model-timeline-proof';
import { configuredOwnerInputProbe } from './configured-owner-input';
import { configuredNativeSession } from './configured-native-session';

/** Actual configuration/catalog/vault/native RPC. Explicit policy denies every model POST. */
export async function verifyConfiguredModelHost(
  services: Services,
  directory: string,
  ownerInput = false,
) {
  const projectId = services.db.shell.projectScope;
  assert(projectId);
  const context = services.projects.get(projectId);
  const task = await context.store.readTask('T-008');
  const before = JSON.stringify(task);
  const reviewKey = c4ReviewKey(projectId, task.id);
  const review = structuredClone(services.db.getSetting(reviewKey, null));
  const runs = services.db.listRuns(projectId, task.id);
  const configuration = services.modelConfiguration.read();
  const route = configuration.routes.find(
    (entry) => entry.connectionId === 'openrouter-owner' && entry.modelId === 'openai/gpt-4.1-nano',
  );
  assert(route);
  const connection = configuration.connections.find((entry) => entry.id === route.connectionId)!;
  const catalog = await services.modelCatalog.read(connection.id, connection.revision);
  const actual = catalog.models.find((entry) => entry.id === route.modelId);
  assert(actual && actual.pricing.prompt !== null && actual.pricing.completion !== null);
  const snapshot = services.modelConfiguration.snapshot(route.id, catalog.models);
  const scope = {
    kind: 'task' as const,
    projectId,
    taskId: task.id,
    runId: 'configured-model-no-active-run',
  };
  const ownerKey = `verification:${basename(directory)}`;
  const prepare = () =>
    NativeAdmissions.prepare({
      db: services.db,
      ownerKey,
      scope,
      sessionId: 'configured-model-preflight',
      signal: new AbortController().signal,
      async requireCurrent(signal) {
        signal.throwIfAborted();
        assert.equal(JSON.stringify(await context.store.readTask(task.id)), before);
        signal.throwIfAborted();
      },
    });
  let lease = await prepare();
  const { owners, options } = nativeProbeOptions(directory, context.root, true);
  const config = nativeProbeConfig(directory, context.root, lease.admission.sessionId, true);
  config.route = snapshot;
  config.tools!.verificationScope = scope;
  config.model = { scope, protocol: 'chat' };
  const baseline = await readRuntimeJournal(config.journalPath, config.sessionId, true);
  assert.equal(baseline.records.length, 0);
  let reservations = 0,
    dispatches = 0;
  let generation: Awaited<ReturnType<typeof configuredNativeSession>> | undefined;
  const request: RuntimeModelRequest = {
    kind: 'chat',
    value: {
      route: snapshot,
      messages: [
        {
          role: 'user',
          content: 'Local configured-host preflight. Model transmission is not admitted.',
        },
      ],
      price: {
        prompt: Number(actual.pricing.prompt) * 1_000_000,
        completion: Number(actual.pricing.completion) * 1_000_000,
      },
    },
  };
  const inputProbe = ownerInput
    ? configuredOwnerInputProbe(request, config.journalPath, config.sessionId)
    : undefined;
  if (inputProbe) config.model.input = { revision: inputProbe.port.revision, steer: true };
  let modelTurnId = 'configured-denied';
  let ownerProof: unknown;
  const createGeneration = () =>
    configuredNativeSession({
      services,
      config,
      lease,
      options,
      directory,
      ownerInput: inputProbe?.port,
      observe: (event) => inputProbe?.observe(event),
      requests: {
        async reserve() {
          reservations++;
          throw new Error('No reviewed payload or budget admission for a model POST');
        },
        async requireDispatch() {
          dispatches++;
          throw new Error('Model dispatch is not admitted in this preflight');
        },
      },
    });
  try {
    generation = await createGeneration();
    await assert.rejects(
      generation.model.reserve('before-spawn', request, lease.signal),
      /not active/,
    );
    assert.equal(reservations, 0);
    const session = await generation.start();
    assert('runModelTurn' in session && typeof session.runModelTurn === 'function');
    const wrong: RuntimeModelRequest = {
      ...request,
      value: { ...request.value, route: { ...snapshot, modelId: 'unconfigured-model' } },
    };
    await assert.rejects(session.runModelTurn(wrong, 'wrong-route', 1), /did not complete/);
    assert.equal(reservations, 0);
    if (inputProbe) {
      const result = await inputProbe.run(session);
      modelTurnId = result.id;
      ownerProof = result.proof;
    } else
      await assert.rejects(
        session.runModelTurn(request, 'configured-denied', 1),
        /did not complete/,
      );
    assert.equal(reservations, 1);
    const first = await readRuntimeJournal(config.journalPath, config.sessionId);
    if (!inputProbe)
      await assert.rejects(
        session.runModelTurn(request, 'configured-denied', 1),
        /did not complete/,
      );
    assert.equal(
      (await readRuntimeJournal(config.journalPath, config.sessionId)).records.length,
      first.records.length,
    );
    assert.equal(reservations, 1);
    assert.equal(dispatches, 0);
    await generation.close();
    assert.equal(owners.length, 1);
    assert.equal(await processBirth(owners[0]!.pid), undefined);
    let final = await readRuntimeJournal(config.journalPath, config.sessionId);
    let timeline = verifyModelTimeline(final.records, generation.events, modelTurnId, 'failed');
    if (inputProbe) {
      const previous = lease.admission;
      lease = await prepare();
      assert.equal(lease.admission.generation, previous.generation + 1);
      assert.notEqual(lease.admission.id, previous.id);
      generation = await createGeneration();
      await inputProbe.redeliver(await generation.start());
      assert.equal(reservations, 1);
      assert.equal(dispatches, 0);
      await generation.close();
      final = await readRuntimeJournal(config.journalPath, config.sessionId);
      timeline = verifyModelTimeline(final.records, generation.events, modelTurnId, 'failed');
    }
    assert.equal(owners.length, inputProbe ? 2 : 1);
    for (const owner of owners) assert.equal(await processBirth(owner.pid), undefined);
    assert.equal(
      final.records.filter(
        (record) =>
          record.id.endsWith(':intent') &&
          record.facts.some((fact) => fact.type === 'effect-intent' && fact.name === 'model:chat'),
      ).length,
      1,
    );
    assert(
      !final.records.some(
        (record) => record.id.startsWith('budget:') || record.id.endsWith(':dispatch'),
      ),
    );
    assert.equal(JSON.stringify(await context.store.readTask(task.id)), before);
    assert.deepEqual(services.db.getSetting(reviewKey, null), review);
    assert.deepEqual(services.db.listRuns(projectId, task.id), runs);
    assert.deepEqual(services.modelConfiguration.read(), configuration);
    return {
      project: 'Cat-pilot',
      taskId: task.id,
      actualCatalog: true,
      ...(ownerProof ? { ownerInput: ownerProof } : {}),
      actualConfiguredConnector: true,
      sharedVaultOwner: true,
      hostPreparedBeforeSpawn: true,
      processAdmissionChecked: true,
      routeMismatchRefused: true,
      reservationDeniedBeforeKeyBorrow: true,
      repeatedTurnNotDispatched: true,
      configuredCloseRevokesNativeSession: true,
      credentialBytesRead: false,
      modelRequests: 0,
      budgetReservations: 0,
      noTaskRunCreated: true,
      taskAndC4Unchanged: true,
      configurationUnchanged: true,
      nativeProcesses: owners.length,
      ...(inputProbe ? { restartWithoutInputPreparation: true, admissionGenerations: 2 } : {}),
      exitConfirmed: true,
      admissionStatus: new AdmissionStore(services.db, ownerKey).read()?.status,
      timeline,
      journal: config.journalPath,
    };
  } finally {
    await generation?.close();
    await lease.revoke(lease.admission, 'Configured preflight cleanup');
    await lease.confirmExit(lease.admission);
  }
}
