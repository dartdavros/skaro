import { expect, it } from 'vitest';
import { OperationLifetime } from './operation-lifetime.ts';
import { operationTimeout } from './operation-timeout.ts';

it('invalidates queued and starting work even after an explicit new operation', async () => {
  const lifetime = new OperationLifetime();
  const queued = lifetime.capture();
  const signal = lifetime.signal;
  const reason = new Error('Owner stopped the operation');
  lifetime.cancel(reason);
  expect(signal.aborted).toBe(true);
  expect(() => lifetime.capture()).toThrow(reason);
  lifetime.renew();
  expect(lifetime.signal.aborted).toBe(false);
  expect(() => lifetime.assert(queued)).toThrow(reason);
  expect(() => lifetime.assert(lifetime.capture())).not.toThrow();
});

it('bounds an unacknowledged operation without treating its timeout as successful cancellation', async () => {
  let finish!: () => void;
  const work = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await expect(operationTimeout(work, 1, 'Unconfirmed stop')).rejects.toThrow('Unconfirmed stop');
  finish();
  await expect(work).resolves.toBeUndefined();
});
