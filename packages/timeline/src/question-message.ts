import { isAsyncQuestion } from './async-question.ts';
import { assertQuestionsAnswered } from './question-barrier.ts';
import type { Interaction } from './model.ts';
import type { TimelineState } from './state.ts';

export interface QuestionMessageReference {
  id: string;
  request: string;
  epoch?: string;
}

export function questionRequestEpoch(
  state: TimelineState,
  question: Extract<Interaction, { kind: 'question' }>,
): string | undefined {
  // Async item IDs survive pagination even when their original turn/item is no longer in the header.
  if (question.delivery === 'async') return question.itemId;
  return state.items.find((item) => item.id === question.itemId)?.turnId ?? state.turns.at(-1)?.id;
}

/** Capture only questions actually visible when the owner submits their message. */
export function questionMessageReferences(
  state?: TimelineState,
  sources?: TimelineState[],
): QuestionMessageReference[] {
  return (
    state?.interactions
      .filter((i) => i.kind === 'question')
      .map((question) => ({
        id: question.id,
        request: JSON.stringify(question),
        epoch: questionRequestEpoch(
          sources?.find((source) => source.interactions.some((i) => i.id === question.id)) ?? state,
          question,
        ),
      })) ?? []
  );
}

/** Composer input is a new owner instruction; protected values still use the form fields. */
export function questionAcceptsMessage(interaction: Interaction): boolean {
  return interaction.kind === 'question';
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
    'The owner sent a message while newer question cards remain unanswered. ' +
    'Address their message without treating it as completed form fields, credentials or consent. ' +
    'Only requests explicitly superseded by that message are cancelled. Keep secret values in their protected fields.'
  );
}
