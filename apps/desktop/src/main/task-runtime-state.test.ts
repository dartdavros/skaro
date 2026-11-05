import { expect, it } from 'vitest';
import { sameTaskRuntime } from './task-runtime-state';

// Pure runtime metadata contracts; no substituted backend, project or agent.
it('treats the absent database row as idle regardless of the completed run identity', () => {
  expect(sameTaskRuntime(undefined, 'idle')).toBe(true);
  expect(sameTaskRuntime(undefined, 'idle', 'completed-run')).toBe(true);
});

it('keeps actual state transitions and active run ownership changes observable', () => {
  for (const state of ['queued', 'running', 'waiting', 'failed'] as const) {
    expect(sameTaskRuntime(undefined, state, 'run')).toBe(false);
    expect(sameTaskRuntime({ state, runId: 'run' }, 'idle', 'run')).toBe(false);
    expect(sameTaskRuntime({ state, runId: 'run' }, state, 'run')).toBe(true);
    expect(sameTaskRuntime({ state, runId: 'run' }, state, 'next-run')).toBe(false);
  }
  expect(sameTaskRuntime({ state: 'running', runId: 'run' }, 'waiting', 'run')).toBe(false);
});
