import { expect, it } from 'vitest';
import { withSkaroNote, withoutSkaroNote } from './feed-input.ts';
import { feedRows } from './feed.ts';
import { emptyTimeline, Timeline } from './state.ts';

it('hides every leading service note in live and restored messages without changing canonical input', () => {
  const text = withSkaroNote(
    'command_id: current-owner-command',
    withSkaroNote('Input snapshot and project memory', 'продолжи'),
  );
  const state = emptyTimeline();
  state.items.push({
    id: 'owner-message',
    turnId: '',
    kind: 'message',
    role: 'user',
    text,
    status: 'done',
    startedAt: 0,
    native: { agent: 'codex', type: 'userMessage', ref: 'owner-message' },
  });
  for (const snapshot of [state, Timeline.restore(structuredClone(state)).state]) {
    const rows = feedRows(snapshot);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type === 'user' && rows[0].item.text).toBe('продолжи');
    expect(snapshot.items[0]?.kind === 'message' && snapshot.items[0].text).toBe(text);
  }
});

it('preserves service-tag examples inside the actual owner message', () => {
  const owner = 'Объясни пример:\n<skaro-note>literal example</skaro-note>\nНе удаляй его.';
  expect(withoutSkaroNote(withSkaroNote('delivery', withSkaroNote('preflight', owner)))).toBe(
    owner,
  );
  expect(withoutSkaroNote(owner)).toBe(owner);
});

it('keeps an incomplete owner block after removing complete leading notes', () => {
  const owner = '<skaro-note>unfinished owner example';
  expect(withoutSkaroNote(withSkaroNote('delivery', owner))).toBe(owner);
  expect(withoutSkaroNote(owner)).toBe(owner);
});
