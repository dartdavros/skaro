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

it('keeps one ordinary composer answer and synchronous request validation intact', () => {
  const single = { ...question, questions: [{ ...question.questions[0]!, secret: false }] };
  expect(questionAcceptsMessage(single)).toBe(false);
  expect(questionAcceptsMessage({ ...question, questions: [question.questions[0]!] })).toBe(true);
  const native = { ...question, delivery: undefined };
  expect(questionAcceptsMessage(native)).toBe(false);
  const state = Timeline.from([{ t: 'interaction.opened', interaction: native }]).state;
  expect(() => assertQuestionMessageAllowed(state)).toThrow('Answer the open questions');
});
