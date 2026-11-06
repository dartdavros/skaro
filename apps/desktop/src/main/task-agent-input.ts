import {
  questionMessageNote,
  withSkaroNote,
  type TimelineState,
  type UserInput,
} from '@skaro/timeline';
import type { MessageInput } from '../shared/ipc';

/** Inbox recovery fields belong to Skaro, not the adapter's durable user input. */
export function taskAgentInput(
  input: MessageInput,
  state?: TimelineState,
  followUp = false,
): UserInput {
  const note = [
    input.commandId && `command_id: ${input.commandId}`,
    input.internal && 'orchestration: task',
    state && questionMessageNote(state, input.internal),
    followUp &&
      !input.internal &&
      'This is an owner follow-up, not automatic authorization to resume the task. ' +
        'If it asks a question, requests status or explanation, answer it and end this turn; ' +
        'do not resume implementation, environment setup, verification or result submission. ' +
        'Only if this message explicitly instructs you to perform or continue task work, ' +
        'call resume_task with this command_id and an exact quote of that instruction before working. ' +
        'If your next action requires an owner decision, invoke the structured question tool ' +
        'with concrete options and wait for the complete answer. Do not ask in plain chat.',
  ]
    .filter(Boolean)
    .join('\n');
  return {
    text: withSkaroNote(note, input.text),
    ...(input.images?.length ? { images: [...input.images] } : {}),
  };
}
