import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { Timeline, type Interaction, type InteractionAnswer } from '@skaro/timeline';
import { QuestionAnswers } from './question-answers';
import { decisionItemId } from './decision-item-id';

const question: Extract<Interaction, { kind: 'question' }> = {
  id: 'req-0',
  kind: 'question',
  questions: [
    {
      id: 'choice',
      header: 'Choice',
      text: 'Continue?',
      multi: false,
      allowFreeText: true,
      options: [],
    },
  ],
};
const answer: InteractionAnswer = { kind: 'question', answers: { choice: ['Continue'] } };

it('reconciles a saved async answer by its exact native item across later turns without closing a reused ID', () => {
  const db = AppDb.open(':memory:');
  try {
    const request: typeof question = {
      ...question,
      id: 'async-observed',
      itemId: 'native-item',
      delivery: 'async',
    };
    const mailbox = new QuestionAnswers(db, 'observed-async-owner');
    mailbox.accept(request, answer, () => undefined, 'original-turn');
    const original = Timeline.from([
      { t: 'turn.started', turnId: 'original-turn' },
      { t: 'interaction.opened', interaction: request },
      { t: 'turn.completed', turnId: 'original-turn', outcome: 'done' },
      { t: 'turn.started', turnId: 'later-turn' },
    ]);
    expect(mailbox.project(original.state).interactions).toEqual([]);
    expect(original.state.interactions).toEqual([request]);
    const reused = Timeline.from([
      { t: 'turn.started', turnId: 'new-request' },
      { t: 'interaction.opened', interaction: { ...request, itemId: 'different-native-item' } },
    ]);
    expect(mailbox.project(reused.state).interactions).toHaveLength(1);
    expect(db.commands.pending()).toEqual([]);
  } finally {
    db.close();
  }
});
function waiting(turn: string) {
  return Timeline.from([
    { t: 'turn.started', turnId: turn },
    { t: 'interaction.opened', interaction: question },
  ]);
}

it('persists acceptance identity across recovery and separates repeated adapter IDs and owners', () => {
  const db = AppDb.open(':memory:');
  try {
    const timeline = waiting('first');
    const mailbox = new QuestionAnswers(db, 'actual-owner');
    mailbox.accept(question, answer, (event) => timeline.apply(event), 'first');
    const first = mailbox.pending(timeline.state)!;
    const restored = waiting('first');
    const projected = mailbox.project(restored.state);
    expect(projected.interactions).toEqual([]);
    expect(restored.state.interactions).toEqual([question]);
    expect(mailbox.project(waiting('second').state).interactions).toEqual([question]);
    new QuestionAnswers(db, 'actual-owner').recover(restored.state, (event) =>
      restored.apply(event),
    );
    expect(restored.state.interactions).toEqual([]);
    expect(mailbox.pending(restored.state)).toEqual(first);
    const later = waiting('second');
    mailbox.recover(later.state, (event) => later.apply(event));
    expect(later.state.interactions).toEqual([question]);
    expect(() => mailbox.accept(question, answer, () => undefined, 'second')).toThrow(
      'earlier answer',
    );
    mailbox.delivered();
    mailbox.accept(question, answer, (event) => timeline.apply(event), 'second');
    const second = mailbox.pending(timeline.state)!;
    expect(second.commandId).not.toBe(first.commandId);
    expect(timeline.state.items.filter((item) => item.kind === 'decision')).toHaveLength(2);
    const other = new QuestionAnswers(db, 'other-owner');
    other.accept(question, answer, () => undefined, 'second');
    expect(other.pending(timeline.state)!.commandId).not.toBe(second.commandId);
    expect(decisionItemId('owner', 'first', 'req-0')).not.toBe(
      decisionItemId('owner', 'second', 'req-0'),
    );
  } finally {
    db.close();
  }
});

it('preserves ambiguous legacy acceptance without closing a newer question or clearing its payload', () => {
  const db = AppDb.open(':memory:');
  try {
    const legacy = [{ interaction: question, answer }];
    db.setSetting('question.answers.legacy', legacy);
    const mailbox = new QuestionAnswers(db, 'legacy');
    const timeline = waiting('new-request');
    mailbox.recover(timeline.state, (event) => timeline.apply(event));
    expect(timeline.state.interactions).toEqual([question]);
    mailbox.queue('task.send', 'project', 'task', timeline.state);
    expect(db.getSetting('question.answers.legacy', null)).toEqual(legacy);
    expect(() => mailbox.accept(question, answer, () => undefined, 'new-request')).toThrow(
      'earlier answer',
    );
    expect(db.commands.pending()).toEqual([]);
  } finally {
    db.close();
  }
});
