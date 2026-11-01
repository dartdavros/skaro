import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { readRuntimeJournal } from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { AgentSession, RuntimeModelRequest, RuntimeProcessIdentity } from '@skaro/timeline';
import type { Services } from '../app-services';
import { c4ReviewKey } from '../c4-review';
import { startBuiltinNativeSession } from '../native/bundled';
import { nativeProbeOptions } from './native-probe-options';
import { nativePlanHost } from './native-model-host';
import { nativeVerificationConnector } from './native-model-connector';

async function turn(session: AgentSession, request: RuntimeModelRequest, id: string, maxSteps = 1) {
  assert('runModelTurn' in session && typeof session.runModelTurn === 'function');
  return session.runModelTurn(request, id, maxSteps);
}
/** Actual services/vault/connector. No reviewed payload means refusal before any POST. */
export async function verifyNativeModelPreflight(
  services: Services,
  data: string,
  directory: string,
  owner: RuntimeProcessIdentity,
) {
  const controller = new AbortController();
  const { connector, vault } = await nativeVerificationConnector(data, owner, controller.signal);
  let prepared = await nativePlanHost(services, directory, owner, connector);
  const before = JSON.stringify(prepared.target.task);
  const reviewKey = c4ReviewKey(prepared.target.context.id, prepared.target.task.id);
  const review = structuredClone(services.db.getSetting(reviewKey, null));
  const { owners, options } = nativeProbeOptions(directory, prepared.target.context.root, true);
  const entries = resolve('apps/desktop/out/main');
  let session: AgentSession | undefined;
  let drain: Promise<void> | undefined;
  const start = async () => {
    session = await startBuiltinNativeSession(
      prepared.config,
      join(directory, 'native-attachments'),
      options,
      {
        verification: prepared.target.verification,
        model: prepared.model,
        signal: controller.signal,
      },
      entries,
    );
    const actual = session;
    drain = (async () => {
      for await (const _event of actual.events) {
        /* Genuine events. */
      }
    })();
  };
  const close = async () => {
    await session?.close();
    await drain;
    session = undefined;
  };
  const snapshot = () => readRuntimeJournal(prepared.config.journalPath, prepared.config.sessionId);
  try {
    await assert.rejects(
      startBuiltinNativeSession(
        prepared.config,
        join(directory, 'native-attachments'),
        options,
        { verification: prepared.target.verification },
        entries,
      ),
      /model.*binding|Model host/i,
    );
    assert.equal(owners.length, 0);
    await start();
    const request: RuntimeModelRequest = { kind: 'chat', value: prepared.payload.request };
    const pending = turn(session!, request, 'preflight');
    void pending.catch(() => undefined);
    await assert.rejects(
      turn(session!, request, 'concurrent'),
      /native model turn is already active/,
    );
    await assert.rejects(pending, /did not complete/);
    const first = await snapshot();
    assert(
      first.records.some(
        (record) =>
          record.id === 'model-preflight-0:failed' &&
          record.result.error === 'Model request not admitted',
      ),
    );
    assert(
      !first.records.some(
        (record) => record.id.startsWith('budget:') || record.id.endsWith(':dispatch'),
      ),
    );
    const count = first.records.length;
    await assert.rejects(turn(session!, request, 'preflight'), /did not complete/);
    assert.equal((await snapshot()).records.length, count);
    await assert.rejects(
      turn(
        session!,
        {
          kind: 'chat',
          value: {
            ...prepared.payload.request,
            route: { ...prepared.config.route, modelId: 'unbound-model' },
          },
        },
        'bad-route',
      ),
      /did not complete/,
    );
    await assert.rejects(turn(session!, request, 'bad-limit', 0), /did not complete/);
    assert.equal(prepared.requestCount(), 0);
    assert('invokeTool' in session! && typeof session!.invokeTool === 'function');
    const inspected = (await session!.invokeTool('inspect_acceptance', {}, 'still-alive')) as {
      criteria: unknown[];
    };
    assert.equal(inspected.criteria.length, 9);
    await close();
    for (const process of owners) assert.equal(await processBirth(process.pid), undefined);
    await assert.rejects(start(), /baseline changed/);
    assert.equal(owners.length, 1);
    const original = prepared;
    prepared = await nativePlanHost(services, directory, owner, connector);
    await start();
    await assert.rejects(
      session!.send({ text: 'Resume only the native model admission preflight' }),
      /no model request was sent/,
    );
    await assert.rejects(turn(session!, request, 'preflight'), /did not complete/);
    await assert.rejects(turn(session!, request, 'after-restart'), /did not complete/);
    assert.equal(original.requestCount() + prepared.requestCount(), 0);
    await close();
    for (const process of owners) assert.equal(await processBirth(process.pid), undefined);
    assert.equal(owners.length, 2);
    const final = await snapshot();
    assert.equal(
      final.records
        .flatMap((record) => record.facts)
        .filter((fact) => fact.type === 'effect-intent' && fact.name === 'model:chat').length,
      2,
    );
    assert.equal(
      JSON.stringify(await prepared.target.context.store.readTask(prepared.target.task.id)),
      before,
    );
    assert.deepEqual(services.db.getSetting(reviewKey, null), review);
    return {
      project: 'Cat-pilot',
      realConnector: true,
      missingHostRejected: true,
      admissionDeniedBeforePost: true,
      concurrentTurnRejectedWithoutExit: true,
      changedRouteRejected: true,
      invalidStepLimitRejected: true,
      repeatedTurnNotDispatched: true,
      staleBaselineRejectedBeforeSpawn: true,
      freshHostRestart: true,
      taskAndC4Unchanged: true,
      nativeProcesses: owners.length,
      exitsConfirmed: true,
      modelRequests: 0,
      reservations: 0,
      journal: prepared.config.journalPath,
    };
  } finally {
    controller.abort();
    await close();
    await vault.close();
  }
}
