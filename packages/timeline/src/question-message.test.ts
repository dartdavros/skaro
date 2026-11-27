import { expect, it } from 'vitest';
import { Timeline } from './state.ts';
import type { Interaction } from './model.ts';
import { assertQuestionsAnswered, validateQuestionAnswer } from './question-barrier.ts';
import { assertQuestionMessageAllowed, questionAcceptsMessage } from './question-message.ts';

const question: Extract<Interaction, { kind: 'question' }> = {
  kind: 'question',
  id: 'protected',
  delivery: 'async',
  questions: ['service', 'access'].map((id) => ({
    id,
    header: id,
    text: id,
    multi: false,
    allowFreeText: true,
    secret: true,
    options: [],
  })),
};

it('delivers a clarification without answering protected fields or unlocking tool work', () => {
  const timeline = Timeline.from([
    { t: 'turn.started', turnId: 'request' },
    { t: 'interaction.opened', interaction: question },
    { t: 'turn.completed', turnId: 'request', outcome: 'interrupted' },
  ]);
  expect(questionAcceptsMessage(question)).toBe(true);
  expect(() => assertQuestionMessageAllowed(timeline.state)).not.toThrow();
  timeline.apply({ t: 'turn.started', turnId: 'clarify' });
  timeline.apply({ t: 'turn.completed', turnId: 'clarify', outcome: 'done' });
  expect(timeline.state.interactions).toEqual([question]);
  expect(timeline.state.status).toBe('waiting');
  expect(() => assertQuestionsAnswered(timeline.state)).toThrow('Answer the open questions');
  expect(() => assertQuestionMessageAllowed(timeline.state, true)).toThrow(
    'Answer the open questions',
  );
  expect(() =>
    validateQuestionAnswer(question, {
      kind: 'question',
      answers: { service: ['Which service?'] },
    }),
  ).toThrow('Answer every question');
});

it('allows every question to be superseded while retaining native validation until cancellation', () => {
  const single = { ...question, questions: [{ ...question.questions[0]!, secret: false }] };
  expect(questionAcceptsMessage(single)).toBe(true);
  expect(questionAcceptsMessage({ ...question, questions: [question.questions[0]!] })).toBe(true);
  const native = { ...question, delivery: undefined };
  expect(questionAcceptsMessage(native)).toBe(true);
  const state = Timeline.from([{ t: 'interaction.opened', interaction: native }]).state;
  expect(() => assertQuestionMessageAllowed(state)).toThrow('Answer the open questions');
});

it('continues work with an unanswered coordinator question and preserves it after the turn', () => {
  const coordinator = {
    ...question,
    id: 'coordinator:incident',
    questions: question.questions.map((field) => ({ ...field, secret: false })),
  };
  const timeline = Timeline.from([
    { t: 'turn.started', turnId: 'work' },
    { t: 'interaction.opened', interaction: coordinator },
  ]);
  expect(timeline.state.status).toBe('working');
  expect(() => assertQuestionsAnswered(timeline.state)).not.toThrow();
  expect(() => assertQuestionMessageAllowed(timeline.state, true)).not.toThrow();
  timeline.apply({ t: 'turn.completed', turnId: 'work', outcome: 'done' });
  expect(timeline.state.interactions).toEqual([coordinator]);
  expect(timeline.state.status).toBe('idle');
  expect(Timeline.restore({ ...timeline.state, status: 'waiting' }).state.status).toBe('idle');
});
