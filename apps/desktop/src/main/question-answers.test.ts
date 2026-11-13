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
