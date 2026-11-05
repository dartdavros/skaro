import { isAsyncQuestion } from './async-question.ts';
import { assertQuestionsAnswered } from './question-barrier.ts';
import type { Interaction } from './model.ts';
import type { TimelineState } from './state.ts';

/** Multi-question and protected async cards use their fields; the composer can ask for context. */
export function questionAcceptsMessage(interaction: Interaction): boolean {
  return (
    isAsyncQuestion(interaction) &&
    (interaction.questions.length !== 1 || interaction.questions.some((q) => q.secret))
  );
}

/** Owner conversation can continue around async cards; tool and automatic-work gates stay strict. */
export function assertQuestionMessageAllowed(state: TimelineState, internal = false): void {
  assertQuestionsAnswered(
    internal
      ? state
      : { ...state, interactions: state.interactions.filter((i) => !isAsyncQuestion(i)) },
  );
}

export function questionMessageNote(state: TimelineState, internal = false): string {
  if (internal || !state.interactions.some(isAsyncQuestion)) return '';
  return (
    'The owner sent a message while question cards remain unanswered. ' +
    'Address their message without treating it as completed form fields, credentials or consent. ' +
    'The existing cards remain open. Keep secret values in their protected fields.'
  );
}
