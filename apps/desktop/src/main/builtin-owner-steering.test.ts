import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename, dirname, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { RuntimeSession, appendChatOwnerInput } from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { RuntimeModelRequest } from '@skaro/timeline';
import { OwnerSteering } from '../../../../packages/agent-runtime/src/models/owner-steering';
import { ModelTurnTimeline } from '../../../../packages/agent-runtime/src/models/turn-timeline';
import { ownerInputRecord } from '../../../../packages/agent-runtime/src/models/owner-input-record';
import { longContextConfig } from './credentials/long-context-config';

const directories: string[] = [];
const sessions: RuntimeSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.dispose();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function boundary() {
  const directory = await mkdtemp(join(tmpdir(), 'skaro-owner-boundary-'));
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith('skaro-owner-boundary-')
  )
    throw new Error('Unexpected verification directory');
  directories.push(directory);
  const config = { ...longContextConfig(directory), context: undefined, tools: undefined };
  const session = await RuntimeSession.open(config, {
    pid: process.pid,
    birth: (await processBirth(process.pid))!,
    platform: process.platform,
  });
  sessions.push(session);
  const lifecycle = new ModelTurnTimeline(session.journal, 'boundary', 'a'.repeat(64));
  const first = ownerInputRecord(
    { id: 'initial', action: { type: 'send', input: { text: 'Initial input' } } },
    lifecycle.turnId,
  );
  await lifecycle.begin(first.facts);
  const steering = new OwnerSteering(
    session.journal,
    { steer: appendChatOwnerInput },
    'boundary',
    lifecycle.turnId,
  );
  const request: RuntimeModelRequest = {
    kind: 'chat',
    value: {
      route: config.route,
      price: { prompt: 0.5, completion: 2 },
      messages: [{ role: 'user', content: first.input.input.text }],
    },
  };
  return { session, lifecycle, steering, request };
}

it('keeps a steering input racing finalization in the same durable turn and seals the next boundary', async () => {
  // Pure input/lifecycle contract: no provider response, HTTP server or model execution.
  const { session, lifecycle, steering, request } = await boundary();
  const text = 'Точный ввод\nwith trailing newline\n';
  const queued = steering.accept({ id: 'steering', action: { type: 'steer', input: { text } } });
  const applied = steering.apply(request, true, new AbortController().signal);
  const record = await queued;
  const next = await applied;
  expect(next?.kind).toBe('chat');
  if (next?.kind !== 'chat' || request.kind !== 'chat') throw new Error('Expected Chat input');
  expect(next.value.messages).toEqual([...request.value.messages, { role: 'user', content: text }]);
  expect(record.facts.find((fact) => fact.type === 'input')?.turnId).toBe(lifecycle.turnId);
  expect(steering.sealed).toBe(false);
  expect(await steering.apply(next, true, new AbortController().signal)).toBeUndefined();
  expect(steering.sealed).toBe(true);
  expect(() =>
    steering.accept({ id: 'late', action: { type: 'steer', input: { text: 'Later' } } }),
  ).toThrow('does not admit');
  expect(session.journal.find('cmd:late')).toBeUndefined();
  expect(session.journal.state.effects).toEqual({});
  expect(
    session.journal.records
      .flatMap((record) => record.facts)
      .filter((fact) => fact.type === 'timeline' && fact.event.t === 'turn.started'),
  ).toHaveLength(1);
});

it('retains acknowledged input without applying it after cancellation', async () => {
  const { session, steering, request } = await boundary();
  await steering.accept({
    id: 'cancelled',
    action: { type: 'steer', input: { text: 'Keep this input' } },
  });
  const controller = new AbortController();
  controller.abort();
  await expect(steering.apply(request, false, controller.signal)).rejects.toThrow();
  expect(session.journal.find('cmd:cancelled')).toBeDefined();
  expect(session.journal.find('owner-steer:cancelled')).toBeUndefined();
  expect(session.journal.state.effects).toEqual({});
});
