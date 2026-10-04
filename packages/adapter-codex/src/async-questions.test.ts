import { expect, it } from 'vitest';
import {
  asyncQuestionInput,
  feedRows,
  Timeline,
  replayRunLog,
  type RawLine,
  type TimelineEvent,
} from '@skaro/timeline';
import { CodexProjector } from './projector.ts';

const noImage = () => {
  throw new Error('Unexpected image');
};

// Wire shapes observed in the real 0.159.2 task log, including async delivery without options.
const item = {
  type: 'agentMessage',
  id: 'call-question',
  delivery: 'async',
  phase: 'final_answer',
  text: 'Укажите адрес штатного локального контура.',
  questions: [{ title: 'Укажите адрес штатного локального контура.', options: null }],
};

it('projects a real async delivery as one persistent card anchored to the agent question', () => {
  const events: TimelineEvent[] = [];
  const projector = new CodexProjector({ now: () => 1, attachImage: noImage }, (e) =>
    events.push(e),
  );
  projector.output({ method: 'turn/started', params: { turn: { id: 't1' } } });
  for (const method of ['item/started', 'item/completed'])
    projector.output({ method, params: { turnId: 't1', item } });
  projector.output({
    method: 'turn/completed',
    params: { turn: { id: 't1', status: 'completed' } },
  });
  const timeline = Timeline.from(events);
  expect(events.filter((e) => e.t === 'interaction.opened')).toHaveLength(1);
  expect(timeline.state.items).toHaveLength(1);
  expect(timeline.state.items[0]).toMatchObject({ role: 'agent', text: item.text });
  expect(timeline.state.status).toBe('idle');
  const question = timeline.state.interactions[0]!;
  expect(question).toMatchObject({
    kind: 'question',
    delivery: 'async',
    questions: [{ id: '0', text: item.text, allowFreeText: true, options: [] }],
  });
  if (question.kind !== 'question' || question.delivery !== 'async')
    throw new Error('No async card');
  expect(
    asyncQuestionInput(
      { ...question, delivery: 'async' },
      { kind: 'question', answers: { '0': ['https://example.com'] } },
    ),
  ).toEqual({ text: 'https://example.com' });
  expect(() =>
    asyncQuestionInput({ ...question, delivery: 'async' }, { kind: 'question', answers: {} }),
  ).toThrow('Answer every question');
});

it.each(['legacy', 'before-echo', 'after-echo'])(
  'keeps question, limit, answer and continuation in order (%s decision)',
  (order) => {
    let now = 1;
    const timeline = new Timeline();
    const projector = new CodexProjector({ now: () => now, attachImage: noImage }, (e) =>
      timeline.apply(e),
    );
    projector.output({ method: 'turn/started', params: { turn: { id: 't1' } } });
    now++;
    projector.output({ method: 'item/completed', params: { turnId: 't1', item } });
    const question = timeline.state.interactions[0]!;
    now++;
    projector.output({
      method: 'error',
      params: {
        turnId: 't1',
        error: { message: 'Usage limit', codexErrorInfo: 'usageLimitExceeded' },
      },
    });
    projector.output({
      method: 'turn/completed',
      params: {
        turn: {
          id: 't1',
          status: 'failed',
          error: { message: 'Usage limit', codexErrorInfo: 'usageLimitExceeded' },
        },
      },
    });
    expect(feedRows(timeline.state).map((row) => row.type)).toEqual([
      'question',
      'notice',
      'turn_end',
    ]);
    const answer = { kind: 'question' as const, answers: { '0': ['Штатный контур'] } };
    const record = () => {
      timeline.apply({ t: 'interaction.closed', id: question.id, resolution: 'answered' });
      timeline.apply({
        t: 'item.upsert',
        item: {
          id: 'decision',
          native: { agent: 'skaro', type: 'decision', ref: question.id },
          turnId: order === 'legacy' ? 't1' : '',
          kind: 'decision',
          interaction: question,
          answer,
          status: 'done',
          startedAt: now,
        },
      });
    };
    now++;
    if (order !== 'after-echo') record();
    projector.output({ method: 'turn/started', params: { turn: { id: 't2' } } });
    projector.output({
      method: 'item/completed',
      params: {
        turnId: 't2',
        item: {
          type: 'userMessage',
          id: 'reply',
          content: [
            {
              type: 'text',
              text: order === 'legacy' ? `${item.text}\nШтатный контур` : 'Штатный контур',
            },
          ],
        },
      },
    });
    if (order === 'after-echo') record();
    now++;
    projector.output({
      method: 'item/completed',
      params: {
        turnId: 't2',
        item: {
          type: 'agentMessage',
          id: 'continuation',
          text: 'Продолжаю проверку',
          phase: 'commentary',
        },
      },
    });
    const rows = feedRows(timeline.state);
    expect(rows.filter((r) => r.type !== 'user' || !r.hidden).map((r) => r.type)).toEqual([
      'agent',
      'notice',
      'turn_end',
      'decision',
      'agent',
    ]);
    expect(rows[0]).toMatchObject({ type: 'agent', item: { role: 'agent', text: item.text } });
    expect(rows.find((r) => r.id === 'reply')).toMatchObject({
      type: 'user',
      hidden: true,
      item: { text: 'Штатный контур' },
    });
    expect(timeline.state.interactions).toHaveLength(0);
    // An ordinary owner message is still shown as a user bubble.
    projector.output({
      method: 'item/completed',
      params: {
        turnId: 't2',
        item: { type: 'userMessage', id: 'normal', content: [{ type: 'text', text: 'Продолжай' }] },
      },
    });
    expect(feedRows(timeline.state).at(-1)).toMatchObject({ type: 'user', id: 'normal' });
    expect(feedRows(timeline.state).at(-1)).not.toHaveProperty('hidden');
  },
);

it('keeps async cards across segments, closes them on a real user reply and does not reopen on duplicate completion', () => {
  const rows: RawLine[] = [
    { ts: 0, dir: 'meta', line: { skaro: 'segment', agent: 'codex', adapterVersion: '0.1.0' } },
    { ts: 1, dir: 'out', line: { method: 'turn/started', params: { turn: { id: 't1' } } } },
    { ts: 2, dir: 'out', line: { method: 'item/completed', params: { turnId: 't1', item } } },
    {
      ts: 3,
      dir: 'out',
      line: { method: 'turn/completed', params: { turn: { id: 't1', status: 'completed' } } },
    },
    { ts: 4, dir: 'meta', line: { skaro: 'segment', agent: 'codex', adapterVersion: '0.1.0' } },
    { ts: 5, dir: 'out', line: { method: 'turn/started', params: { turn: { id: 't2' } } } },
    {
      ts: 6,
      dir: 'out',
      line: {
        method: 'item/completed',
        params: {
          turnId: 't2',
          item: {
            type: 'userMessage',
            id: 'reply',
            content: [{ type: 'text', text: 'Оставить заблокированным' }],
          },
        },
      },
    },
  ];
  const replay = (lines: RawLine[]) =>
    Timeline.from(replayRunLog(lines, 0, (ctx, emit) => new CodexProjector(ctx, emit), noImage))
      .state;
  expect(replay(rows.slice(0, 4)).interactions).toHaveLength(1);
  expect(replay(rows).interactions).toHaveLength(0);
  const events: TimelineEvent[] = [];
  const projector = new CodexProjector({ now: () => 1, attachImage: noImage }, (e) =>
    events.push(e),
  );
  projector.output(rows[2]!.line);
  projector.output(rows[6]!.line);
  projector.output(rows[2]!.line);
  expect(Timeline.from(events).state.interactions).toHaveLength(0);
});

it('maps string options and preserves multiple questions while synchronous requests still expire', () => {
  const timeline = new Timeline();
  const projector = new CodexProjector({ now: () => 1, attachImage: noImage }, (e) =>
    timeline.apply(e),
  );
  projector.output({
    method: 'item/completed',
    params: {
      item: {
        ...item,
        questions: [
          { title: 'Контур?', options: ['Штатный контур', 'Оставить заблокированным'] },
          { title: 'Аккаунт?', options: null },
        ],
      },
    },
  });
  projector.output({
    id: 1,
    method: 'item/tool/requestUserInput',
    params: { questions: [{ id: 'sync', header: 'Контур', question: 'Контур?', options: [] }] },
  });
  timeline.apply({
    t: 'item.upsert',
    item: {
      id: 'child-user',
      native: { agent: 'codex', type: 'userMessage', ref: 'child-user' },
      turnId: 'child-turn',
      parentId: 'child-agent',
      kind: 'message',
      role: 'user',
      text: 'Continue the delegated task',
      status: 'done',
      startedAt: 1,
    },
  });
  expect(timeline.state.interactions).toHaveLength(2);
  projector.output({
    method: 'turn/completed',
    params: { turn: { id: 't1', status: 'completed' } },
  });
  expect(timeline.state.interactions).toHaveLength(1);
  expect(timeline.state.interactions[0]).toMatchObject({
    questions: [
      { id: '0', options: [{ label: 'Штатный контур' }, { label: 'Оставить заблокированным' }] },
      { id: '1', options: [] },
    ],
  });
});
