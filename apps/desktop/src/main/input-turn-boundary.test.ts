import type { TimelineEvent } from '@skaro/timeline';
import { expect, it } from 'vitest';
import { InputTurnBoundary } from './input-turn-boundary';

it('holds the slot for the exact interrupted turn and leaves other completions to the scheduler', async () => {
  const boundary = new InputTurnBoundary('current');
  let ended = false;
  const observed = boundary.completion.then(() => {
    ended = true;
  });
  expect(boundary.consumes({ t: 'turn.completed', turnId: 'prior', outcome: 'done' })).toBe(false);
  await Promise.resolve();
  expect(ended).toBe(false);
  expect(
    boundary.consumes({ t: 'turn.completed', turnId: 'current', outcome: 'interrupted' }),
  ).toBe(true);
  await observed;
  expect(ended).toBe(true);
});

it('distinguishes verified retirement from provider failure or unsolicited process exit', async () => {
  const boundary = new InputTurnBoundary('current');
  const exit: TimelineEvent = {
    t: 'turn.completed',
    turnId: 'current',
    outcome: 'failed',
    error: { category: 'other', source: 'process_exit', message: 'Codex stopped (1)' },
  };
  expect(boundary.expectedExit(exit)).toBe(false);
  expect(boundary.consumes(exit)).toBe(false);
  await boundary.completion;
  boundary.retiring = true;
  expect(boundary.expectedExit(exit)).toBe(true);
  expect(boundary.expectedExit({ ...exit, turnId: 'different' })).toBe(false);
  expect(
    boundary.expectedExit({ ...exit, error: { category: 'network', message: 'Disconnected' } }),
  ).toBe(false);
});
