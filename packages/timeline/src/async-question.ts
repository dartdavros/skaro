import type { Interaction, InteractionAnswer } from './model.ts';
import type { UserInput } from './agent.ts';

export type AsyncQuestion = Extract<Interaction, { kind: 'question' }> & { delivery: 'async' };
export const OWNER_QUESTION_PREFIX = 'owner-question:';
export const TASK_SECRET_QUESTION_PREFIX = 'skaro-secret-';

export function isAsyncQuestion(
  interaction: Interaction | undefined,
): interaction is AsyncQuestion {
  return interaction?.kind === 'question' && interaction.delivery === 'async';
}

/** A coordinator question reserves a decision on its incident while the agent can keep working. */
export function isDeferredInteraction(interaction: Interaction): boolean {
  const coordinator = interaction.id.startsWith('coordinator:');
  if (interaction.kind === 'approval') return coordinator && interaction.delivery === 'async';
  return (
    isAsyncQuestion(interaction) &&
    (interaction.id.startsWith(TASK_SECRET_QUESTION_PREFIX) ||
      ((coordinator || interaction.id.startsWith(OWNER_QUESTION_PREFIX)) &&
        interaction.questions.every((question) => !question.secret)))
  );
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
  return (
    interaction.kind === 'merge' ||
    interaction.kind === 'question' ||
    (interaction.kind === 'approval' && interaction.delivery === 'async')
  );
}
