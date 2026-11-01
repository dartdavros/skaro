import assert from 'node:assert/strict';
import { Timeline, type TimelineEvent } from '@skaro/timeline';
import { SkaroProjector, type JournalRecord } from '@skaro/agent-runtime';
import { presentationState } from '../timeline-presentation';

/** Compare actual native events with the existing projector over the real primary journal. */
export function verifyModelTimeline(
  records: JournalRecord[],
  events: TimelineEvent[],
  id: string,
  outcome: 'done' | 'failed',
  text?: string,
) {
  const replay = new Timeline();
  const projector = new SkaroProjector((event) => replay.apply(event));
  for (const record of records) projector.output(record);
  assert.deepEqual(presentationState(replay.state), Timeline.from(events).state);
  const started = records.find((record) => record.id === `model-lifecycle:${id}:started`);
  const begin = started?.facts.find(
    (fact) => fact.type === 'timeline' && fact.event.t === 'turn.started',
  );
  assert(begin?.type === 'timeline' && begin.event.t === 'turn.started');
  const turnId = begin.event.turnId;
  assert.equal(replay.state.turns.find((turn) => turn.id === turnId)?.outcome, outcome);
  assert.equal(
    events.filter((event) => event.t === 'turn.started' && event.turnId === turnId).length,
    1,
  );
  assert.equal(
    events.filter((event) => event.t === 'turn.completed' && event.turnId === turnId).length,
    1,
  );
  const messages = replay.state.items.filter(
    (item) => item.turnId === turnId && item.kind === 'message' && item.role === 'agent',
  );
  if (text !== undefined) {
    assert.equal(messages.map((item) => (item.kind === 'message' ? item.text : '')).join(''), text);
    assert(messages.length && messages.every((item) => item.status === 'done'));
    assert(messages.some((item) => item.kind === 'message' && item.phase === 'final'));
  } else assert.equal(messages.length, 0);
  return {
    canonicalTurnOutcome: outcome,
    liveReplayEqual: true,
    terminalEventExactlyOnce: true,
    assistantMessages: messages.length,
    runningItemsAfterClose: replay.hasRunningItems,
  };
}
