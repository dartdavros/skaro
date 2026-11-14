import { expect, it } from 'vitest';
import { feedRows, groupFeedRows, type Item, type TimelineState } from '@skaro/timeline';
import type { HistoryPage, HistorySource } from '../../../shared/history';
import { matchesOwnerMessage, visibleOwnerMessages } from './owner-message-history';

const input = { commandId: 'current-command', text: 'Continue the discussion' };
const at = 10_000;
const message: Item = {
  id: 'native-message',
  turnId: '',
  kind: 'message',
  role: 'user',
  text: `<skaro-note>\ncommand_id: ${input.commandId}\n</skaro-note>\n\n${input.text}`,
  status: 'done',
  startedAt: at,
  native: { agent: 'codex', type: 'user_message', ref: 'native-message' },
};
const timeline: TimelineState = {
  items: [message],
  turns: [],
  interactions: [],
  status: 'idle',
};
const history: HistorySource = { owner: 'project:chat:chat', key: 'root', revision: 2, count: 1 };
const page: HistoryPage = {
  source: history,
  start: 0,
  blocks: groupFeedRows(feedRows(timeline)),
};

it('keeps the echo when a native acknowledgement arrives before the history page', () => {
  expect(visibleOwnerMessages(timeline, { history })).toEqual([]);
  const visible = visibleOwnerMessages(timeline, { history, historyPage: page });
  expect(visible.some((item) => matchesOwnerMessage(item, input, at))).toBe(true);
  expect(visibleOwnerMessages(timeline)).toEqual([message]);
});

it('does not retire the echo using an old page, another conversation or a nested range', () => {
  for (const source of [
    { ...history, revision: 1 },
    { ...history, owner: 'project:task:task' },
    { ...history, key: 'nested' },
    { ...history, count: 0 },
  ])
    expect(visibleOwnerMessages(timeline, { history, historyPage: { ...page, source } })).toEqual(
      [],
    );
  expect(
    visibleOwnerMessages(timeline, {
      history: { ...history, revision: 3, contentRevision: 2 },
      historyPage: page,
    }),
  ).toEqual([message]);
});

it('reconciles a loaded durable owner row without waiting for a native message', () => {
  const owner: Item = {
    ...message,
    id: `owner-${input.commandId}`,
    text: input.text,
    native: { agent: 'skaro', type: 'owner_command', ref: input.commandId },
  };
  const state = { ...timeline, items: [owner] };
  const historyPage = { ...page, blocks: groupFeedRows(feedRows(state)) };
  const visible = visibleOwnerMessages(state, { history, historyPage });
  expect(visible.some((item) => matchesOwnerMessage(item, input, at))).toBe(true);
});

it('does not confuse subagent messages or an older repeated input with the sent message', () => {
  expect(matchesOwnerMessage({ ...message, parentId: 'subagent' }, input, at)).toBe(false);
  expect(
    matchesOwnerMessage({ ...message, text: input.text, startedAt: at - 3000 }, input, at),
  ).toBe(false);
  expect(
    matchesOwnerMessage(
      { ...message, text: message.text.replace(input.commandId, 'previous-command') },
      input,
      at,
    ),
  ).toBe(false);
  expect(matchesOwnerMessage({ ...message, text: input.text }, input, at)).toBe(true);
});
