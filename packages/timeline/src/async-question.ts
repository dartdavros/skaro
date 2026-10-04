import type { Interaction, InteractionAnswer } from './model.ts';
import type { UserInput } from './agent.ts';

export type AsyncQuestion = Extract<Interaction, { kind: 'question' }> & { delivery: 'async' };

export function isAsyncQuestion(
  interaction: Interaction | undefined,
): interaction is AsyncQuestion {
  return interaction?.kind === 'question' && interaction.delivery === 'async';
}

/** Async questions are answered by a user message, rather than a server-request reply. */
export function asyncQuestionInput(question: AsyncQuestion, answer: InteractionAnswer): UserInput {
  if (answer.kind !== 'question') throw new Error('A question answer is required');
  const replies = question.questions.map((q) => {
    const values = answer.answers[q.id]?.filter((value) => value.trim());
    if (!values?.length) throw new Error('Answer every question');
    return values.join('\n');
  });
  return { text: replies.join('\n\n') };
}

export function persistsAfterTurn(interaction: Interaction): boolean {
  return interaction.kind === 'merge' || isAsyncQuestion(interaction);
}
