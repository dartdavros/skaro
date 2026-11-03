import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { readRuntimeJournal } from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import {
  operationTimeout,
  type AgentSession,
  type RuntimeProcessIdentity,
  type TimelineEvent,
} from '@skaro/timeline';
import type { Services } from '../app-services';
import { startBuiltinNativeSession } from '../native/bundled';
import { c4ReviewKey } from '../c4-review';
import { nativePlanHost } from './native-model-host';
import { nativeVerificationConnector } from './native-model-connector';
import { nativeProbeOptions } from './native-probe-options';
import { verifyModelTimeline } from './model-timeline-proof';
import { bindConfiguredModelHost } from '../builtin-configured-model-host';

/** Real queued input and host preparation. The actual request admission refuses every model POST. */
export async function verifyNativeOwnerSteer(
  services: Services,
  data: string,
  directory: string,
  owner: RuntimeProcessIdentity,
) {
  const controller = new AbortController();
  const { connector, vault, reference } = await nativeVerificationConnector(
    data,
    owner,
    controller.signal,
  );
  const prepared = await nativePlanHost(
    services,
    directory,
    owner,
    connector,
    undefined,
    'steering',
  );
  const target = prepared.target;
  const configuration = services.modelConfiguration.read();
  let configurationGate = 'unconfigured-refused';
  if (!configuration.routes.some((route) => route.id === prepared.model.route.routeId)) {
    assert.throws(
      () => bindConfiguredModelHost(services.modelConfiguration, prepared.model, reference),
      /unavailable/,
    );
  } else {
    try {
      const configured = bindConfiguredModelHost(
        services.modelConfiguration,
        prepared.model,
        reference,
      );
      configured.close();
      assert(configured.signal.aborted);
      configurationGate = 'current-released';
    } catch (error) {
      assert(error instanceof Error && /unavailable/.test(error.message));
      configurationGate = 'stale-refused';
    }
  }
  const before = JSON.stringify(target.task);
  const reviewKey = c4ReviewKey(target.context.id, target.task.id);
  const review = structuredClone(services.db.getSetting(reviewKey, null));
  const { owners, options } = nativeProbeOptions(directory, target.context.root, true);
  const events: TimelineEvent[] = [];
  let session: AgentSession | undefined;
  let drain: Promise<void> | undefined;
  let completed!: () => void;
  const terminal = new Promise<void>((resolve) => {
    completed = resolve;
  });
  try {
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
        if (event.t === 'turn.completed') completed();
      }
    })();
    assert('deliverInput' in session && typeof session.deliverInput === 'function');
    const deliver = session.deliverInput.bind(session);
    const input = { text: prepared.payload.request.messages[0]!.content! };
    const first = deliver(input, 'initial', 'send');
    const second = deliver(input, 'steering', 'steer');
    const contextChange = assert.rejects(session.setPermissionMode('full'), /active model turn/);
    await Promise.all([first, second, contextChange]);
    await operationTimeout(terminal, 30_000, 'Steered native turn did not terminate');
    const snapshot = await readRuntimeJournal(
      prepared.config.journalPath,
      prepared.config.sessionId,
    );
    const initial = snapshot.records.find((record) => record.id === 'cmd:initial')!;
    const steered = snapshot.records.find((record) => record.id === 'cmd:steering')!;
    const id = (initial.result.value as { modelTurnId: string }).modelTurnId;
    assert.deepEqual(steered.result.value, { kind: 'owner-input', mode: 'steer', modelTurnId: id });
    const inputs = [initial, steered].map((record) =>
      record.facts.find((fact) => fact.type === 'input'),
    );
    assert(
      inputs.every(
        (fact) => fact?.type === 'input' && JSON.stringify(fact.input) === JSON.stringify(input),
      ),
    );
    assert.equal(inputs[0]!.turnId, inputs[1]!.turnId);
    const applied = snapshot.records.find((record) => record.id === 'owner-steer:steering')!;
    const value = applied.result.value as {
      input: { sequence: number; hash: string };
      request: { kind: string; value: { messages: unknown[] } };
    };
    assert.deepEqual(value.input, { sequence: steered.sequence, hash: steered.hash });
    assert.equal(value.request.kind, 'chat');
    assert.deepEqual(value.request.value.messages, [
      ...prepared.payload.request.messages,
      { role: 'user', content: input.text },
    ]);
    assert.equal(prepared.preparationCount(), 1);
    assert.equal(prepared.steeringCount(), 1);
    assert.equal(prepared.requestCount(), 0);
    assert.equal(
      snapshot.records
        .flatMap((record) => record.facts)
        .filter((fact) => fact.type === 'effect-intent' && fact.name === 'model:chat').length,
      1,
    );
    assert(
      !snapshot.records.some(
        (record) => record.id.startsWith('budget:') || record.id.endsWith(':dispatch'),
      ),
    );
    const count = snapshot.records.length;
    await deliver(input, 'steering', 'steer');
    assert.equal(
      (await readRuntimeJournal(prepared.config.journalPath, prepared.config.sessionId)).records
        .length,
      count,
    );
    assert.equal(prepared.steeringCount(), 1);
    await session.close();
    await drain;
    session = undefined;
    const final = await readRuntimeJournal(prepared.config.journalPath, prepared.config.sessionId);
    const timeline = verifyModelTimeline(final.records, events, id, 'failed');
    for (const process of owners) assert.equal(await processBirth(process.pid), undefined);
    assert.equal(JSON.stringify(await target.context.store.readTask(target.task.id)), before);
    assert.deepEqual(services.db.getSetting(reviewKey, null), review);
    assert.deepEqual(services.modelConfiguration.read(), configuration);
    return {
      project: 'Cat-pilot',
      sameTurnOwnerInputs: 2,
      initialPreparations: 1,
      steeringPreparations: 1,
      appliedBeforeModelIntent:
        applied.sequence <
        snapshot.records.find((record) => record.id.endsWith(':intent'))!.sequence,
      exactDurableInputs: true,
      contextChangeRefused: true,
      redeliveryWithoutPreparation: true,
      modelIntents: 1,
      modelRequests: 0,
      reservations: 0,
      timeline,
      nativeProcesses: owners.length,
      exitsConfirmed: true,
      taskAndC4Unchanged: true,
      modelConfigurationUnchanged: true,
      configurationGate,
      journal: prepared.config.journalPath,
      notice:
        'Real input/preparation boundary; provider response and terminal-response steering are not accepted',
    };
  } finally {
    controller.abort();
    await session?.close();
    await drain;
    await vault.close();
  }
}
