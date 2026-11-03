import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import {
  operationTimeout,
  type AgentSession,
  type TimelineEvent,
  type RuntimeProcessIdentity,
} from '@skaro/timeline';
import { readRuntimeJournal } from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { Services } from '../app-services';
import { startBuiltinNativeSession } from '../native/bundled';
import { c4ReviewKey } from '../c4-review';
import { nativeVerificationConnector } from './native-model-connector';
import { nativePlanHost } from './native-model-host';
import { nativeProbeOptions } from './native-probe-options';
import { verifyModelTimeline } from './model-timeline-proof';

/** Ordinary input transport to real host preparation; no reviewed payload means no model POST. */
export async function verifyNativeOwnerInput(
  services: Services,
  data: string,
  directory: string,
  owner: RuntimeProcessIdentity,
) {
  const controller = new AbortController();
  const { connector, vault } = await nativeVerificationConnector(data, owner, controller.signal);
  let prepared = await nativePlanHost(services, directory, owner, connector, undefined, true);
  const target = prepared.target;
  const before = JSON.stringify(target.task);
  const reviewKey = c4ReviewKey(target.context.id, target.task.id);
  const review = structuredClone(services.db.getSetting(reviewKey, null));
  const { owners, options } = nativeProbeOptions(directory, target.context.root, true);
  const input = { text: prepared.payload.request.messages[0]!.content! };
  const events: TimelineEvent[] = [];
  let session: AgentSession | undefined;
  let drain: Promise<void> | undefined;
  let terminal: (() => void) | undefined;
  let stage = 'startup';
  const start = async () => {
    session = await startBuiltinNativeSession(
      prepared.config,
      join(directory, 'native-attachments'),
      options,
      { model: prepared.model, verification: target.verification, signal: controller.signal },
      resolve('apps/desktop/out/main'),
    );
    const actual = session;
    drain = (async () => {
      for await (const event of actual.events) {
        events.push(event);
        if (event.t === 'turn.completed') terminal?.();
      }
    })();
  };
  const snapshot = () => readRuntimeJournal(prepared.config.journalPath, prepared.config.sessionId);
  const close = async () => {
    await session?.close();
    await drain;
    session = undefined;
  };
  const waitForTurn = () =>
    new Promise<void>((resolve) => {
      terminal = resolve;
    });
  const deliver = async (id: string, text = input.text) => {
    assert(session && 'deliverInput' in session && typeof session.deliverInput === 'function');
    return session.deliverInput({ text }, id, 'send');
  };
  try {
    await start();
    const done = waitForTurn();
    await session!.send(input);
    stage = 'terminal';
    await operationTimeout(done, 30_000, 'Owner input did not receive a real terminal event');
    const first = await snapshot();
    stage = 'durable-input';
    const ack = first.records.find(
      (record) => (record.result.value as { kind?: string } | undefined)?.kind === 'owner-input',
    );
    assert(ack && !ack.result.error);
    const modelId = (ack.result.value as { modelTurnId: string }).modelTurnId;
    const fact = ack.facts.find((fact) => fact.type === 'input');
    assert(fact?.type === 'input');
    assert.deepEqual(fact.input, input);
    stage = 'host-preparation';
    assert.equal(prepared.preparationCount(), 1);
    assert.equal(prepared.requestCount(), 0);
    assert(
      !first.records.some((record) =>
        record.facts.some((fact) => fact.type === 'effect-intent' && fact.name === 'model:chat'),
      ),
    );
    stage = 'dedup';
    const count = first.records.length;
    const commandId = ack.id.slice('cmd:'.length);
    await deliver(commandId);
    stage = 'dedup-record-count';
    assert.equal((await snapshot()).records.length, count);
    assert.equal(prepared.preparationCount(), 1);
    stage = 'changed-id';
    await assert.rejects(deliver(commandId, `${input.text} Changed`), /identity reused/);
    stage = 'invalid-image';
    await assert.rejects(
      session!.send({ text: '', images: ['not-an-authorized-image'] }),
      /Image input/,
    );
    await assert.rejects(session!.send({ text: '' }), /Input is empty/);
    stage = 'timeline';
    await close();
    const final = await snapshot();
    const timeline = verifyModelTimeline(final.records, events, modelId, 'failed');
    const old = prepared;
    stage = 'restart';
    prepared = await nativePlanHost(services, directory, owner, connector, undefined, true);
    await start();
    const resumedCount = (await snapshot()).records.length;
    await deliver(commandId);
    assert.equal((await snapshot()).records.length, resumedCount);
    assert.equal(prepared.preparationCount(), 0);
    await close();
    for (const process of owners) assert.equal(await processBirth(process.pid), undefined);
    assert.equal(owners.length, 2);
    assert.equal(JSON.stringify(await target.context.store.readTask(target.task.id)), before);
    assert.deepEqual(services.db.getSetting(reviewKey, null), review);
    return {
      project: 'Cat-pilot',
      ordinarySendAcknowledged: true,
      exactDurableOwnerInput: true,
      preparationAfterDurableInput: true,
      unreviewedPayloadRefusedBeforeIntent: true,
      dedupWithoutPreparation: true,
      restartDoesNotRedeliver: true,
      invalidInputRejected: true,
      timeline,
      preparations: old.preparationCount() + prepared.preparationCount(),
      modelRequests: 0,
      nativeProcesses: owners.length,
      exitsConfirmed: true,
      taskAndC4Unchanged: true,
      journal: prepared.config.journalPath,
    };
  } catch (error) {
    process.send?.({
      type: 'owner-input-preflight-failed',
      stage,
      preparations: prepared.preparationCount(),
      modelRequests: prepared.requestCount(),
    });
    throw error;
  } finally {
    controller.abort();
    await close();
    await vault.close();
  }
}
