import { expect, it } from 'vitest';
import { emptyTimeline } from '@skaro/timeline';
import { exitedAgentTurn, sessionRecovered } from './incident-session-verification';

it('requires a native turn after the exact recorded process failure; a later failure invalidates recovery', () => {
  const state = emptyTimeline();
  state.turns.push({
    id: 'failed',
    outcome: 'failed',
    error: { category: 'other', message: 'Codex stopped (1)' },
  });
  const proof = { runId: 'run', failedTurnId: 'failed' };
  expect(exitedAgentTurn(state)?.id).toBe('failed');
  expect(sessionRecovered(state, proof)).toBe(false);
  state.turns.push({ id: 'diagnosis' });
  expect(sessionRecovered(state, proof)).toBe(true);
  state.turns[1]!.outcome = 'failed';
  expect(sessionRecovered(state, proof)).toBe(false);
  state.turns[1]!.outcome = 'done';
  expect(sessionRecovered(state, proof)).toBe(true);
  expect(sessionRecovered(state, { ...proof, failedTurnId: 'different' })).toBe(false);
  state.turns[1]!.outcome = 'interrupted';
  expect(sessionRecovered(state, proof)).toBe(false);
  state.turns.push({ id: 'after-owner-answer' });
  expect(sessionRecovered(state, proof)).toBe(true);
});

it('does not mistake an external service failure for a recovered agent transport', () => {
  const state = emptyTimeline();
  state.turns.push({
    id: 'service',
    outcome: 'failed',
    error: { category: 'network', message: 'Service unavailable' },
  });
  state.turns.push({ id: 'next', outcome: 'done' });
  expect(exitedAgentTurn(state)).toBeUndefined();
  expect(sessionRecovered(state, { runId: 'run', failedTurnId: 'service' })).toBe(false);
});
