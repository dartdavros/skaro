import {
  questionMessageNote,
  withSkaroNote,
  type TimelineState,
  type UserInput,
} from '@skaro/timeline';
import type { MessageInput } from '../shared/ipc';

export const RESUMED_ENVIRONMENT =
  'Continue with start_environment if this task needs services. ' +
  'The project coordinator checks the earlier recovery receipt and current configuration. ' +
  'Use the live tool result, repair documented task-local prerequisites, and continue the task. ' +
  'For an external prerequisite, send the exact evidence to the project coordinator with report_task_blocker.';

/** Inbox recovery fields belong to Skaro, not the adapter's durable user input. */
export function taskAgentInput(
  input: MessageInput,
  state?: TimelineState,
  followUp = false,
  resumed = false,
): UserInput {
  const note = [
    input.commandId && `command_id: ${input.commandId}`,
    input.internal && 'orchestration: task',
    state && questionMessageNote(state, input.internal),
    resumed &&
      'Skaro resumed task execution when the owner submitted this message. ' +
        'Address the message and continue work from the saved task state in this turn. ' +
        RESUMED_ENVIRONMENT +
        ' If you need a decision from the owner, use Skaro ask_owner and continue independent work.',
    followUp &&
      !resumed &&
      !input.internal &&
      'An explicit owner instruction to work or continue applies even if the task was paused or stopped. ' +
        'If it only asks a question, requests status or explanation, answer without resuming ' +
        'implementation, environment setup, verification or result submission. Follow any Skaro ' +
        'instructions for a cancelled protected form before ending the turn. ' +
        'For a command to perform or continue task work, immediately call resume_task with this ' +
        'command_id and an exact quote of that instruction, then carry it out in this turn. ' +
        'If your next action requires an owner decision, call Skaro ask_owner with concrete options. ' +
        'Await the answer for that action and continue independent work.',
  ]
    .filter(Boolean)
    .join('\n');
  return {
    text: withSkaroNote(note, input.text),
    ...(input.images?.length ? { images: [...input.images] } : {}),
  };
}
