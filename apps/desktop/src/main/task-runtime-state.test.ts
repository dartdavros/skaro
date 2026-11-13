import { expect, it } from 'vitest';
import { Timeline } from '@skaro/timeline';
import { sameTaskRuntime, taskTimelineRuntime } from './task-runtime-state';

it('keeps environment recovery distinct from an actual owner question across turn completion', () => {
  const timeline = new Timeline();
  timeline.apply({ t: 'turn.started', turnId: 'environment-start' });
  expect(taskTimelineRuntime(timeline.state, true)).toBe('running');
  timeline.apply({ t: 'turn.completed', turnId: 'environment-start', outcome: 'done' });
  expect(taskTimelineRuntime(timeline.state, true)).toBe('queued');
  expect(taskTimelineRuntime(timeline.state, false)).toBe('idle');
  timeline.apply({
    t: 'interaction.opened',
    interaction: {
      id: 'coordinator:owner-decision',
      kind: 'question',
      delivery: 'async',
      questions: [],
    },
  });
  expect(taskTimelineRuntime(timeline.state, true)).toBe('waiting');
  timeline.apply({
    t: 'interaction.closed',
    id: 'coordinator:owner-decision',
    resolution: 'answered',
  });
  expect(taskTimelineRuntime(timeline.state, true)).toBe('queued');
  timeline.apply({ t: 'turn.started', turnId: 'continued' });
  expect(taskTimelineRuntime(timeline.state, false)).toBe('running');
});

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
