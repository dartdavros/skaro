import {
  questionMessageNote,
  withSkaroNote,
  type TimelineState,
  type UserInput,
} from '@skaro/timeline';
import type { MessageInput } from '../shared/ipc';

/** Inbox recovery fields belong to Skaro, not the adapter's durable user input. */
export function taskAgentInput(input: MessageInput, state?: TimelineState): UserInput {
  const note = [
    input.commandId && `command_id: ${input.commandId}`,
    input.internal && 'orchestration: task',
    state && questionMessageNote(state, input.internal),
  ]
    .filter(Boolean)
    .join('\n');
  return {
    text: withSkaroNote(note, input.text),
    ...(input.images?.length ? { images: [...input.images] } : {}),
  };
}
