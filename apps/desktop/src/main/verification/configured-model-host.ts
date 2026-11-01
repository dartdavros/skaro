import assert from 'node:assert/strict';
import { basename, join, resolve } from 'node:path';
import { readRuntimeJournal } from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { AgentSession, RuntimeModelRequest, TimelineEvent } from '@skaro/timeline';
import type { Services } from '../app-services';
import { NativeAdmissions } from '../native/admissions';
import { AdmissionStore } from '../native/admission-state';
import { startBuiltinNativeSession } from '../native/bundled';
import { prepareConfiguredModelHost } from '../builtin-configured-host';
import { modelNetworkTransport } from '../model-network-transport';
import { nativeProbeConfig, nativeProbeOptions } from './native-probe-options';
import { c4ReviewKey } from '../c4-review';
import { verifyModelTimeline } from './model-timeline-proof';

/** Actual configuration/catalog/vault/native RPC. Explicit policy denies every model POST. */
export async function verifyConfiguredModelHost(services: Services, directory: string) {
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
  const lease = await NativeAdmissions.prepare({
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
  const { owners, options } = nativeProbeOptions(directory, context.root, true);
  const recordOwner = options.processStarted!;
  options.processStarted = (pid, identity) => {
    assert(identity);
    recordOwner(pid, identity);
    lease.recordOwnership({ pid, ...identity });
  };
  const config = nativeProbeConfig(directory, context.root, lease.admission.sessionId, true);
  config.route = snapshot;
  config.tools!.verificationScope = scope;
  config.model = { scope, protocol: 'chat' };
  const baseline = await readRuntimeJournal(config.journalPath, config.sessionId, true);
  assert.equal(baseline.records.length, 0);
  let reservations = 0,
    dispatches = 0;
  let configured: Awaited<ReturnType<typeof prepareConfiguredModelHost>> | undefined;
  let session: AgentSession | undefined;
  let drain: Promise<void> | undefined;
  const events: TimelineEvent[] = [];
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
  try {
    configured = await prepareConfiguredModelHost({
      store: services.modelConfiguration,
      settings: services.modelSettings,
      binding: {
        scope,
        admission: lease.admission,
        route: snapshot,
        journalPath: config.journalPath,
        baseSequence: 0,
        baseHash: '',
        policy: config.model,
      },
      admissions: lease,
      signal: lease.signal,
      transport: await modelNetworkTransport(process.env['SKARO_VERIFY_PROXY']),
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
    await assert.rejects(
      configured.model.reserve('before-spawn', request, lease.signal),
      /not active/,
    );
    assert.equal(reservations, 0);
    session = await startBuiltinNativeSession(
      config,
      join(directory, 'native-attachments'),
      options,
      {
        signal: configured.signal,
        model: configured.model,
        verification: {
          scope,
          admission: lease.admission,
          acceptance: services.runs.builtinAcceptance(scope, lease),
        },
      },
      resolve('apps/desktop/out/main'),
    );
    const active = session;
    drain = (async () => {
      for await (const event of active.events) events.push(event);
    })();
    await lease.requireActive(lease.admission, lease.signal);
    assert('runModelTurn' in session && typeof session.runModelTurn === 'function');
    const wrong: RuntimeModelRequest = {
      ...request,
      value: { ...request.value, route: { ...snapshot, modelId: 'unconfigured-model' } },
    };
    await assert.rejects(session.runModelTurn(wrong, 'wrong-route', 1), /did not complete/);
    assert.equal(reservations, 0);
    await assert.rejects(session.runModelTurn(request, 'configured-denied', 1), /did not complete/);
    assert.equal(reservations, 1);
    const first = await readRuntimeJournal(config.journalPath, config.sessionId);
    await assert.rejects(session.runModelTurn(request, 'configured-denied', 1), /did not complete/);
    assert.equal(
      (await readRuntimeJournal(config.journalPath, config.sessionId)).records.length,
      first.records.length,
    );
    assert.equal(reservations, 1);
    assert.equal(dispatches, 0);
    configured.close();
    await session.close();
    await drain;
    session = undefined;
    await lease.revoke(lease.admission, 'Configured preflight completed');
    await lease.confirmExit(lease.admission);
    assert.equal(owners.length, 1);
    assert.equal(await processBirth(owners[0]!.pid), undefined);
    const final = await readRuntimeJournal(config.journalPath, config.sessionId);
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
    const timeline = verifyModelTimeline(final.records, events, 'configured-denied', 'failed');
    assert.equal(JSON.stringify(await context.store.readTask(task.id)), before);
    assert.deepEqual(services.db.getSetting(reviewKey, null), review);
    assert.deepEqual(services.db.listRuns(projectId, task.id), runs);
    assert.deepEqual(services.modelConfiguration.read(), configuration);
    return {
      project: 'Cat-pilot',
      taskId: task.id,
      actualCatalog: true,
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
      nativeProcesses: 1,
      exitConfirmed: true,
      admissionStatus: new AdmissionStore(services.db, ownerKey).read()?.status,
      timeline,
      journal: config.journalPath,
    };
  } finally {
    configured?.close();
    await lease.revoke(lease.admission, 'Configured preflight cleanup');
    await session?.close();
    await drain;
    await lease.confirmExit(lease.admission);
  }
}
