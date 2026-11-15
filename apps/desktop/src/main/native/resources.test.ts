import { expect, it } from 'vitest';
import type { SessionOptions } from '@skaro/timeline';
import { NativeResources } from './resources';

type Admission = NonNullable<SessionOptions['resourceAdmission']>;
type TurnHolding = Awaited<ReturnType<Admission['turn']>>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Pure ownership-port metadata and deferred receipts: no process, provider, server or project fixture.
function metadataAdmission() {
  const live = new Set<string>();
  const released: string[] = [];
  const attempts: { result: ReturnType<typeof deferred<TurnHolding>>; needsWork: boolean }[] = [];
  const holding = (id: string) => {
    live.add(id);
    return {
      release: () => {
        expect(live.delete(id), `holding ${id} must release exactly once`).toBe(true);
        released.push(id);
      },
    };
  };
  const resources = new NativeResources({
    resourceAdmission: {
      process: async () => holding('process'),
      turn: async (_signal, _connection, needsWork) => {
        const result = deferred<TurnHolding>();
        attempts.push({ result, needsWork: needsWork === true });
        return result.promise;
      },
    },
  });
  const grant = (index: number) => {
    const attempt = attempts[index]!;
    attempt.result.resolve({
      ...holding(`model-${index}`),
      ...(attempt.needsWork ? { work: holding(`work-${index}`) } : {}),
    });
  };
  return { resources, live, released, attempts, grant };
}

async function activeSuspendedTurn(value: ReturnType<typeof metadataAdmission>) {
  const admitted = value.resources.before('send');
  value.grant(0);
  expect(await admitted).toBe(true);
  value.resources.event({ t: 'turn.started', turnId: 'original' });
  value.resources.event({
    t: 'interaction.opened',
    interaction: {
      kind: 'approval',
      id: 'approval',
      action: { type: 'other', title: 'Current operation' },
      choices: ['allow_once', 'deny'],
    },
  });
  expect(value.live.size).toBe(0);
  expect(value.resources.idle).toBe(false); // An unanswered active turn cannot be closed as idle.
}
const completeOriginal = (resources: NativeResources) =>
  resources.event({ t: 'turn.completed', turnId: 'original', outcome: 'done' });
async function flushUntil(condition: () => boolean) {
  for (let count = 0; count < 20 && !condition(); count++) await Promise.resolve();
  expect(condition()).toBe(true);
}

it('releases a late strict model/work grant when its active generation ended and notifies idle after settlement', async () => {
  const value = metadataAdmission();
  await activeSuspendedTurn(value);
  const idle: boolean[] = [];
  value.resources.onIdle(() => idle.push(value.resources.idle));
  const pending = value.resources.before('steer', true);
  expect(value.attempts).toHaveLength(2);
  completeOriginal(value.resources);
  expect(value.resources.idle).toBe(false);
  expect(idle).toEqual([]);
  value.grant(1);
  expect(await pending).toBe(false);
  expect(value.live.size).toBe(0);
  expect(value.released.slice(-2)).toEqual(['model-1', 'work-1']);
  expect(value.resources.idle).toBe(true);
  expect(idle).toEqual([true]);
  value.resources.closed();
});

it('reacquires for an ordinary send joined to expired strict admission before allowing ordinary dispatch', async () => {
  const value = metadataAdmission();
  await activeSuspendedTurn(value);
  const idle: boolean[] = [];
  value.resources.onIdle(() => idle.push(value.resources.idle));
  const strict = value.resources.before('steer', true);
  let ordinarySettled = false;
  const ordinary = value.resources.before('send').then((admitted) => {
    ordinarySettled = true;
    return admitted;
  });
  completeOriginal(value.resources);
  value.grant(1);
  expect(await strict).toBe(false);
  await flushUntil(() => value.attempts.length === 3);
  expect(ordinarySettled).toBe(false);
  expect(value.live.size).toBe(0);
  expect(value.resources.idle).toBe(false);
  expect(idle).toEqual([]);
  value.grant(2);
  expect(await ordinary).toBe(true);
  expect([...value.live]).toEqual(['model-2', 'work-2']);
  expect(value.resources.idle).toBe(false);
  value.resources.event({ t: 'turn.started', turnId: 'next-owner-input' });
  value.resources.event({ t: 'turn.completed', turnId: 'next-owner-input', outcome: 'done' });
  expect(value.live.size).toBe(0);
  expect(idle).toEqual([true]);
  value.resources.closed();
});

it('does not release an ordinary-owned grant when a joined strict caller expires', async () => {
  const value = metadataAdmission();
  await activeSuspendedTurn(value);
  const ordinary = value.resources.before('send');
  const strict = value.resources.before('steer', true);
  completeOriginal(value.resources);
  value.grant(1);
  expect(await ordinary).toBe(true);
  expect(await strict).toBe(false);
  expect(value.attempts).toHaveLength(2);
  expect([...value.live]).toEqual(['model-1', 'work-1']);
  value.resources.closed();
  expect(value.live.size).toBe(0);
});

it('drops a strict grant if another turn replaced the captured generation before admission', async () => {
  const value = metadataAdmission();
  await activeSuspendedTurn(value);
  const pending = value.resources.before('steer', true);
  completeOriginal(value.resources);
  value.resources.event({ t: 'turn.started', turnId: 'replacement' });
  value.grant(1);
  expect(await pending).toBe(false);
  expect(value.live.size).toBe(0);
  expect(value.resources.idle).toBe(false);
  value.resources.closed();
});

it('releases freshly resolved model/work holdings after Stop or confirmed transport closure', async () => {
  for (const terminate of ['stop', 'closed'] as const) {
    const value = metadataAdmission();
    await activeSuspendedTurn(value);
    const pending = value.resources.before('steer', true);
    const rejected = expect(pending).rejects.toThrow(terminate === 'stop' ? 'stopped' : 'closed');
    value.resources[terminate]();
    value.grant(1);
    await rejected;
    expect(value.live.size).toBe(0);
    expect(value.released.slice(-2)).toEqual(['model-1', 'work-1']);
    value.resources.closed();
    expect(value.resources.idle).toBe(true);
  }
});
