import type { Interaction, InteractionAnswer } from './model.ts';
import type { TimelineState } from './state.ts';
import { isDeferredInteraction } from './async-question.ts';

export function assertQuestionsAnswered(state: TimelineState): void {
  if (state.interactions.some((i) => i.kind === 'question' && !isDeferredInteraction(i)))
    throw new Error('Answer the open questions before continuing this session.');
}

export function validateQuestionAnswer(
  interaction: Interaction | undefined,
  answer: InteractionAnswer,
): void {
  if (!interaction) throw new Error('This interaction is no longer open.');
  if (interaction.kind !== 'question') return;
  if (answer.kind !== 'question') throw new Error('A question answer is required.');
  for (const question of interaction.questions) {
    const values = answer.answers[question.id];
    if (!values?.length || values.some((value) => typeof value !== 'string' || !value.trim()))
      throw new Error('Answer every question before continuing.');
    if (!question.multi && values.length > 1) throw new Error('Choose one answer.');
    if (
      !question.allowFreeText &&
      !question.secret &&
      values.some((value) => !question.options.some((option) => option.label === value))
    )
      throw new Error('Choose one of the question options.');
  }
  if (Object.keys(answer.answers).some((id) => !interaction.questions.some((q) => q.id === id)))
    throw new Error('The answer contains an unknown question.');
}
