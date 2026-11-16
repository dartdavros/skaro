import { expect, it } from 'vitest';
import { activityKind, currentActivity, liveActivity } from './activity.ts';
import { Timeline } from './state.ts';

it('shares native activity mapping, environment priority and model-wait fallback', () => {
  for (const state of ['thinking', 'writing', 'preparing_edit', 'waiting_model']) {
    expect(activityKind({ state })).toBe(state);
    expect(activityKind({ state }, true)).toBe('starting_environment');
  }
  expect(activityKind(undefined)).toBe('waiting_model');
  expect(activityKind({ state: 'unknown' })).toBe('waiting_model');
});

it('clears the card activity after a turn stops and resets to model-wait on the next turn', () => {
  const timeline = new Timeline();
  expect(currentActivity(timeline.state)).toBeUndefined();
  timeline.apply({ t: 'turn.started', turnId: 'first' });
  timeline.apply({ t: 'activity', state: 'preparing_edit', target: 'file.ts' });
  expect(currentActivity(timeline.state)).toBe('preparing_edit');
  timeline.apply({ t: 'turn.completed', turnId: 'first', outcome: 'interrupted' });
  expect(currentActivity(timeline.state)).toBeUndefined();
  timeline.apply({ t: 'turn.started', turnId: 'second' });
  expect(currentActivity(timeline.state)).toBe('waiting_model');
});

it('prioritizes only a running Skaro environment tool and returns to native activity afterwards', () => {
  const timeline = new Timeline();
  timeline.apply({ t: 'turn.started', turnId: 'environment' });
  timeline.apply({ t: 'activity', state: 'thinking' });
  const tool = {
    kind: 'tool' as const,
    id: 'environment',
    turnId: 'environment',
    startedAt: 0,
    name: 'start_environment',
    server: 'other',
    status: 'running' as const,
    native: { agent: 'skaro', type: 'tool', ref: 'environment' },
  };
  timeline.apply({ t: 'item.upsert', item: tool });
  expect(currentActivity(timeline.state)).toBe('thinking');
  timeline.apply({ t: 'item.upsert', item: { ...tool, server: 'skaro' } });
  expect(currentActivity(timeline.state)).toBe('starting_environment');
  timeline.apply({ t: 'item.upsert', item: { ...tool, server: 'skaro', status: 'done' } });
  expect(currentActivity(timeline.state)).toBe('thinking');
});

it('shows the edit until completion despite model deltas and ignores old/subagent edits', () => {
  const timeline = new Timeline();
  timeline.apply({ t: 'turn.started', turnId: 'edit' });
  timeline.apply({ t: 'activity', state: 'writing' });
  const edit = {
    id: 'patch',
    turnId: 'edit',
    startedAt: 1,
    kind: 'file_change' as const,
    files: [{ path: 'file.ts', change: 'update' as const }],
    status: 'running' as const,
    native: { agent: 'codex', type: 'fileChange', ref: 'patch' },
  };
  timeline.apply({ t: 'item.upsert', item: { ...edit, parentId: 'subagent' } });
  expect(currentActivity(timeline.state)).toBe('writing');
  timeline.apply({ t: 'item.upsert', item: edit });
  timeline.apply({ t: 'activity', state: 'thinking' });
  expect(currentActivity(timeline.state)).toBe('preparing_edit');
  timeline.apply({ t: 'item.upsert', item: { ...edit, status: 'done' } });
  timeline.apply({ t: 'activity', state: 'waiting_model' });
  expect(currentActivity(timeline.state)).toBe('waiting_model');
  timeline.apply({ t: 'turn.completed', turnId: 'edit', outcome: 'done' });
  timeline.apply({ t: 'turn.started', turnId: 'next' });
  timeline.apply({ t: 'item.upsert', item: edit });
  expect(currentActivity(timeline.state)).toBe('waiting_model');
});

it('shows root compaction through model deltas and restoration, then restores the actual activity', () => {
  const timeline = new Timeline();
  timeline.apply({ t: 'turn.started', turnId: 'compact' });
  timeline.apply({ t: 'activity', state: 'thinking' });
  const notice = {
    id: 'compaction',
    turnId: 'compact',
    startedAt: 1,
    kind: 'notice' as const,
    level: 'info' as const,
    code: 'compaction' as const,
    text: 'compacting',
    status: 'running' as const,
    native: { agent: 'codex', type: 'contextCompaction', ref: 'compaction' },
  };
  timeline.apply({ t: 'item.upsert', item: { ...notice, parentId: 'subagent' } });
  expect(currentActivity(timeline.state)).toBe('thinking');
  timeline.apply({ t: 'item.upsert', item: notice });
  timeline.apply({ t: 'activity', state: 'waiting_model' });
  expect(liveActivity(timeline.state)).toEqual({ state: 'compacting_context' });
  expect(currentActivity(timeline.state)).toBe('compacting_context');
  expect(activityKind(liveActivity(timeline.state), true)).toBe('compacting_context');
  const restored = Timeline.restore(structuredClone(timeline.state));
  expect(currentActivity(restored.state)).toBe('compacting_context');
  restored.apply({ t: 'item.upsert', item: { ...notice, status: 'done' } });
  expect(currentActivity(restored.state)).toBe('waiting_model');
  restored.apply({ t: 'turn.completed', turnId: 'compact', outcome: 'done' });
  expect(currentActivity(restored.state)).toBeUndefined();
});

it.each(['failed', 'interrupted'] as const)(
  'does not retain compaction after a %s turn or leak it into the next turn',
  (outcome) => {
    const timeline = new Timeline();
    timeline.apply({ t: 'turn.started', turnId: 'compact' });
    const notice = {
      id: 'compaction',
      turnId: 'compact',
      startedAt: 1,
      kind: 'notice' as const,
      level: 'info' as const,
      code: 'compaction' as const,
      text: 'compacting',
      status: 'running' as const,
      native: { agent: 'claude-code', type: 'notice', ref: 'compaction' },
    };
    timeline.apply({ t: 'item.upsert', item: notice });
    expect(currentActivity(timeline.state)).toBe('compacting_context');
    timeline.apply({ t: 'turn.completed', turnId: 'compact', outcome });
    expect(currentActivity(timeline.state)).toBeUndefined();
    timeline.apply({ t: 'turn.started', turnId: 'next' });
    timeline.apply({ t: 'item.upsert', item: notice });
    expect(currentActivity(timeline.state)).toBe('waiting_model');
  },
);
