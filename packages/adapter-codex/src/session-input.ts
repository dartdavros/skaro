import {
  arr,
  obj,
  type Interaction,
  type InteractionAnswer,
  type UserInput,
} from '@skaro/timeline';

export const PERMISSION_CONTINUATION =
  'The user changed the permission mode. Continue the previous request from where ' +
  'you stopped, using the current permissions. Check whether interrupted commands ' +
  'already took effect before retrying them. This changes tool permissions only; ' +
  'keep following the user’s instructions and the agreed scope.';

export function isPermissionContinuation(content: unknown): boolean {
  const elements = arr(content);
  const element = obj(elements[0]);
  return (
    elements.length === 1 &&
    element?.['type'] === 'text' &&
    element['text'] === PERMISSION_CONTINUATION
  );
}

export function toInput(input: UserInput): unknown[] {
  return [
    { type: 'text', text: input.text, text_elements: [] },
    ...(input.images ?? []).map((path) => ({ type: 'localImage', path })),
  ];
}

export function toCodexAnswer(interaction: Interaction, answer: InteractionAnswer): unknown {
  switch (answer.kind) {
    case 'question':
      return {
        answers: Object.fromEntries(
          Object.entries(answer.answers).map(([id, answers]) => [id, { answers }]),
        ),
      };
    case 'form':
      return answer.action === 'accept'
        ? { action: 'accept', content: answer.values ?? {}, _meta: null }
        : { action: 'decline', content: null, _meta: null };
    case 'login':
      return { action: answer.action === 'done' ? 'accept' : 'cancel', content: null, _meta: null };
    case 'approval':
      if (interaction.kind !== 'approval') break;
      return {
        decision:
          answer.choice === 'allow_once'
            ? 'accept'
            : answer.choice === 'allow_session'
              ? 'acceptForSession'
              : 'decline',
      };
    default:
      break;
  }
  return { decision: 'decline' };
}
