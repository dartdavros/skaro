import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from './model.ts';
import type { Emit } from './projection.ts';
import { replayRunLog, type RawLine } from './replay.ts';
import { Timeline } from './state.ts';

const message = (id: string, text: string, turnId = 't1'): TimelineEvent => ({
  t: 'item.upsert',
  item: {
    id,
    turnId,
    kind: 'message',
    role: 'agent',
    text,
    status: 'done',
    startedAt: 0,
    native: { agent: 'test', type: 'text', ref: id },
  },
});

describe('Timeline', () => {
  it('continues from a snapshot as if it had seen every event', () => {
    const events: TimelineEvent[] = [
      { t: 'turn.started', turnId: 't1' },
      message('m1', 'Hel'),
      { t: 'item.append', itemId: 'm1', field: 'text', chunk: 'lo' },
    ];
    const snapshot = JSON.parse(JSON.stringify(Timeline.from(events).state));
    const restored = Timeline.restore(snapshot);
    const rest: TimelineEvent[] = [
      { t: 'item.append', itemId: 'm1', field: 'text', chunk: '!' },
      { t: 'usage', inputTokens: 1200, outputTokens: 300 },
      { t: 'turn.completed', turnId: 't1', outcome: 'done' },
    ];
    rest.forEach((e) => restored.apply(e));
    expect(restored.state).toEqual(Timeline.from([...events, ...rest]).state);
    expect(restored.state.items[0]).toMatchObject({ text: 'Hello!' });
    expect(restored.state.turns).toEqual([
      { id: 't1', outcome: 'done', usage: { inputTokens: 1200, outputTokens: 300 } },
    ]);
  });
});

describe('replayRunLog', () => {
  it('starts a new projector per segment and keeps Skaro events in place', () => {
    const created: number[] = [];
    let n = 0;
    const createProjector = (ctx: { now(): number }, emit: Emit) => {
      const index = n++;
      created.push(index);
      let count = 0;
      return {
        input: () => undefined,
        output: (line: unknown) =>
          emit(message(`p${index}-${count++}`, `${String(line)} @${ctx.now()}`)),
      };
    };
    const lines: RawLine[] = [
      { ts: 0, dir: 'meta', line: { skaro: 'segment', agent: 'test', adapterVersion: '1' } },
      { ts: 10, dir: 'out', line: 'a' },
      {
        ts: 20,
        dir: 'meta',
        line: { skaro: 'event', event: { t: 'status', state: 'idle' } },
      },
      { ts: 30, dir: 'meta', line: { skaro: 'segment', agent: 'test', adapterVersion: '1' } },
      { ts: 40, dir: 'err', line: 'noise' },
      { ts: 50, dir: 'out', line: 'b' },
    ];
    const events = replayRunLog(lines, 1000, createProjector, () => {
      throw new Error('no images');
    });
    expect(created).toEqual([0, 1]);
    expect(events).toEqual([
      message('p0-0', 'a @1010'),
      { t: 'status', state: 'idle' },
      message('p1-0', 'b @1050'),
    ]);
  });
});
