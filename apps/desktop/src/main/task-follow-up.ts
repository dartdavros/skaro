import { FINISH } from './task-wait-card';
import { randomUUID } from 'node:crypto';
import { withoutSkaroNote, type TimelineState } from '@skaro/timeline';
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
  if (isPendingAnswer(input, pendingAnswer)) {
    if (pendingAnswer?.resumeTask && input.commandId) {
      execution.followUp(input.commandId, FINISH);
      return { ...input, resumeTask: true };
    }
    execution.decisionAnswered();
    return input;
  }
  if (input.commandId?.startsWith('answers-')) return input;
  const accepted = { ...input, commandId: input.commandId ?? randomUUID() };
  execution.followUp(
    accepted.commandId,
    withoutSkaroNote(input.text),
    state.interactions.some((i) => i.kind === 'question'),
  );
  return accepted;
}

export function ownerResumeText(input: MessageInput, pendingAnswer?: MessageInput): string {
  if (input.commandId?.startsWith('answers-')) return '';
  return input.internal || input.privateText || isPendingAnswer(input, pendingAnswer)
    ? ''
    : withoutSkaroNote(input.text).trim();
}

function isPendingAnswer(input: MessageInput, answer?: MessageInput): boolean {
  return !!answer?.commandId && answer.commandId === input.commandId && answer.text === input.text;
}
