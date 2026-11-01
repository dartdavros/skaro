import assert from 'node:assert/strict';
import { appendChatOwnerInput, readRuntimeJournal } from '@skaro/agent-runtime';
import {
  operationTimeout,
  type AgentSession,
  type RuntimeModelInputPort,
  type RuntimeModelRequest,
  type TimelineEvent,
} from '@skaro/timeline';

/** Real owner-input DTOs through the production RPC/formatter; request admission still denies POST. */
export function configuredOwnerInputProbe(
  base: RuntimeModelRequest,
  journalPath: string,
  sessionId: string,
) {
  assert.equal(base.kind, 'chat');
  const initial = {
    text: 'Local configured owner-input preflight. Do not transmit a model request.',
  };
  const steering = {
    text: 'Keep this configured-host check local; no model request is authorized.',
  };
  let preparations = 0,
    steerings = 0;
  let completed: (() => void) | undefined;
  const snapshot = () => readRuntimeJournal(journalPath, sessionId);
  const port: RuntimeModelInputPort = {
    revision: 'configured-owner-input-v1',
    async prepare(input, signal) {
      signal.throwIfAborted();
      assert.deepEqual(input.input, initial);
      const record = (await snapshot()).records.find(
        (record) => record.id === `cmd:${input.commandId}`,
      );
      assert(record?.facts.some((fact) => fact.type === 'input' && fact.id === input.id));
      assert.equal(base.kind, 'chat');
      preparations++;
      return {
        request: structuredClone({
          ...base,
          value: {
            ...base.value,
            messages: [{ role: 'user' as const, content: input.input.text }],
          },
        }),
        maxSteps: 1,
      };
    },
    async steer(input, request, terminal, signal) {
      assert.deepEqual(input.input, steering);
      steerings++;
      return appendChatOwnerInput(input, request, terminal, signal);
    },
  };
  const redeliver = async (session: AgentSession) => {
    assert('deliverInput' in session && typeof session.deliverInput === 'function');
    const before = await snapshot();
    await session.deliverInput(initial, 'configured-initial', 'send');
    await session.deliverInput(steering, 'configured-steering', 'steer');
    assert.equal((await snapshot()).records.length, before.records.length);
    assert.equal(preparations, 1);
    assert.equal(steerings, 1);
  };
  return {
    port,
    redeliver,
    observe(event: TimelineEvent) {
      if (event.t === 'turn.completed') completed?.();
    },
    async run(session: AgentSession) {
      assert('deliverInput' in session && typeof session.deliverInput === 'function');
      const done = new Promise<void>((resolve) => {
        completed = resolve;
      });
      const send = session.deliverInput.bind(session);
      await Promise.all([
        send(initial, 'configured-initial', 'send'),
        send(steering, 'configured-steering', 'steer'),
      ]);
      await operationTimeout(done, 30_000, 'Configured owner turn did not terminate');
      completed = undefined;
      const current = await snapshot();
      const inputs = ['configured-initial', 'configured-steering'].map((id) =>
        current.records.find((record) => record.id === `cmd:${id}`)!,
      );
      assert(inputs.every((record) => record && !record.result.error));
      const id = (inputs[0]!.result.value as { modelTurnId: string }).modelTurnId;
      assert.deepEqual(inputs[1]!.result.value, {
        kind: 'owner-input',
        mode: 'steer',
        modelTurnId: id,
      });
      for (const [index, expected] of [initial, steering].entries()) {
        const fact = inputs[index]!.facts.find((fact) => fact.type === 'input');
        assert(fact?.type === 'input');
        assert.deepEqual(fact.input, expected);
      }
      assert.equal(preparations, 1);
      assert.equal(steerings, 1);
      const applied = current.records.find(
        (record) => record.id === 'owner-steer:configured-steering',
      )!;
      const value = applied.result.value as {
        input: { sequence: number; hash: string };
        request: RuntimeModelRequest;
      };
      assert.deepEqual(value.input, { sequence: inputs[1]!.sequence, hash: inputs[1]!.hash });
      assert.equal(value.request.kind, 'chat');
      assert(value.request.kind === 'chat');
      assert.deepEqual(value.request.value.messages, [
        { role: 'user', content: initial.text },
        { role: 'user', content: steering.text },
      ]);
      assert(
        applied.sequence <
          current.records.find((record) => record.id.endsWith(':intent'))!.sequence,
      );
      await redeliver(session);
      await assert.rejects(
        send({ text: `${initial.text} Changed` }, 'configured-initial', 'send'),
        /identity reused/,
      );
      return {
        id,
        proof: {
          durableOwnerInputs: 2,
          initialPreparations: 1,
          steeringPreparations: 1,
          exactInputs: true,
          sameTurn: true,
          appliedBeforeModelIntent: true,
          repeatedInputsNotPrepared: true,
          conflictingIdentityRefused: true,
        },
      };
    },
  };
}
