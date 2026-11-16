import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { Timeline, type Interaction } from '@skaro/timeline';
import { QuestionAnswers } from './question-answers';
import { DecisionReplies, decisionReplyUncertain } from './decision-replies';
import { projectDecisionProjection, decisionHash } from './decision-projection';
import { questionReplyProof } from './question-answer-proof';

it('keeps mailbox and acceptance proof inside the outer incident commit, including rollback', () => {
  const db = AppDb.open(':memory:');
  try {
    const question: Extract<Interaction, { kind: 'question' }> = {
      id: 'request',
      kind: 'question',
      delivery: 'async',
      questions: [
        {
          id: 'resolution',
          text: 'Restart the registered environment?',
          header: '',
          multi: false,
          allowFreeText: true,
          options: [],
        },
      ],
    };
    const answer = { kind: 'question' as const, answers: { resolution: ['Restart'] } };
    const mailbox = new QuestionAnswers(db, 'active.run');
    const timeline = Timeline.from([
      { t: 'turn.started', turnId: 'turn' },
      { t: 'interaction.opened', interaction: question },
    ]);
    const entry = projectDecisionProjection([
      {
        projectId: process.cwd(),
        id: 'task',
        kind: 'task',
        title: '',
        epoch: 'run',
        timeline: timeline.state,
      },
    ])[0]!;
    const hash = decisionHash({ kind: 'respond', answer });
    const events: unknown[] = [];
    expect(() =>
      db.settings.atomic(() => {
        mailbox.accept(question, answer, (event) => events.push(event), 'turn');
        throw new Error('Incident commit rejected');
      }),
    ).toThrow('Incident commit rejected');
    expect(db.getSetting('question.answers.active.run', null)).toBeNull();
    expect(questionReplyProof(db, entry, hash)).toBeUndefined();
    db.settings.atomic(() => mailbox.accept(question, answer, () => undefined, 'turn'));
    expect(db.getSetting('question.answers.active.run', null)).not.toBeNull();
    expect(questionReplyProof(db, entry, hash)).toBe('answered');
  } finally {
    db.close();
  }
});

it('acknowledges an answer committed before a journal failure, survives mailbox delivery and never repeats the effect', async () => {
  const db = AppDb.open(':memory:');
  try {
    const question: Extract<Interaction, { kind: 'question' }> = {
      id: 'req-0',
      kind: 'question',
      delivery: 'async',
      questions: [
        {
          id: 'choice',
          text: 'Choose',
          header: '',
          multi: false,
          allowFreeText: true,
          options: [],
        },
      ],
    };
    const timeline = Timeline.from([
      { t: 'turn.started', turnId: 'epoch' },
      { t: 'interaction.opened', interaction: question },
    ]);
    const [entry] = projectDecisionProjection([
      {
        projectId: 'project',
        id: 'chat',
        kind: 'chat',
        title: '',
        epoch: 'log',
        timeline: timeline.state,
      },
    ]);
    const answer = { kind: 'question' as const, answers: { choice: ['Continue'] } };
    let calls = 0;
    const replies = new DecisionReplies(db);
    const mailbox = new QuestionAnswers(db, 'live.chat');
    await replies.accept(
      entry!,
      { kind: 'respond', answer },
      async () => undefined,
      async () => {
        calls++;
        mailbox.accept(
          question,
          answer,
          () => {
            throw new Error('Journal unavailable after commit');
          },
          'epoch',
        );
      },
    );
    expect(replies.status(entry!)).toBe('answered');
    expect(decisionReplyUncertain(db, entry!)).toBe(false);
    mailbox.delivered();
    await new DecisionReplies(db).accept(
      entry!,
      { kind: 'respond', answer },
      async () => {
        throw new Error('Must not revalidate stale card');
      },
      async () => {
        calls++;
      },
    );
    expect(calls).toBe(1);
    const reused = projectDecisionProjection([
      {
        projectId: 'project',
        id: 'chat',
        kind: 'chat',
        title: '',
        epoch: 'log',
        timeline: Timeline.from([
          { t: 'turn.started', turnId: 'new-epoch' },
          { t: 'interaction.opened', interaction: question },
        ]).state,
      },
    ])[0]!;
    expect(replies.status(reused)).toBeUndefined();
  } finally {
    db.close();
  }
});
