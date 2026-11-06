import { randomUUID } from 'node:crypto';
import type { TimelineState } from '@skaro/timeline';
import type { MessageInput } from '../shared/ipc';
import type { TaskExecution } from './task-execution';

/** Only a delivery from the durable answer mailbox carries completed question fields. */
export function prepareTaskFollowUp(
  execution: TaskExecution,
  input: MessageInput,
  state: TimelineState,
  pendingAnswer?: MessageInput,
): MessageInput {
  if (input.internal) return input;
  if (
    pendingAnswer?.commandId &&
    pendingAnswer.commandId === input.commandId &&
    pendingAnswer.text === input.text
  ) {
    execution.decisionAnswered();
    return input;
  }
  const accepted = { ...input, commandId: input.commandId ?? randomUUID() };
  execution.followUp(
    accepted.commandId,
    input.text,
    state.interactions.some((i) => i.kind === 'question'),
  );
  return accepted;
}
