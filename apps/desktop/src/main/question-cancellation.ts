import type { AppDb } from '@skaro/core';
import {
  questionRequestEpoch,
  withSkaroNote,
  type Interaction,
  type TimelineEvent,
  type TimelineState,
} from '@skaro/timeline';
import type { MessageInput } from '../shared/ipc';
import { QuestionRetirements } from './question-retirements';
import { QuestionAnswers } from './question-answers';
import { DecisionNotDispatched } from './decision-not-dispatched';
import { TASK_SECRET_QUESTION_PREFIX } from './task-secret-input';

type Question = Extract<Interaction, { kind: 'question' }>;
export interface QuestionCancellationContext {
  db: AppDb;
  owner: string;
  state: TimelineState;
  emit(event: TimelineEvent): void;
  flush(): void | Promise<void>;
  interrupt?(): Promise<void>;
  retireShared?(id: string, reason: string): Promise<void>;
}

/** Durable retirement and the live closing event are one application operation. */
export async function cancelQuestionRequests(
  context: QuestionCancellationContext,
  questions: Question[],
  reason: string,
): Promise<void> {
  if (!reason.trim()) throw new DecisionNotDispatched('A cancellation reason is required');
  const epochs = new Map(questions.map((q) => [q.id, questionRequestEpoch(context.state, q)]));
  if (questions.some((q) => q.delivery !== 'async')) {
    if (!context.interrupt)
      throw new DecisionNotDispatched('Native question transport is unavailable');
    await context.interrupt();
  }
  const retirements = new QuestionRetirements(context.db, context.owner);
  context.db.settings.atomic(() => {
    for (const question of questions)
      retirements.cancel(
        question,
        reason,
        question.delivery === 'async' && !question.itemId ? undefined : epochs.get(question.id),
      );
  });
  for (const question of questions) {
    if (question.id.startsWith('coordinator:') && context.retireShared)
      await context.retireShared(question.id.slice('coordinator:'.length), reason);
    const current = context.state.interactions.find((q) => q.id === question.id);
    if (
      current &&
      (JSON.stringify(current) !== JSON.stringify(question) ||
        (current.kind === 'question' &&
          epochs.get(question.id) !== questionRequestEpoch(context.state, current)))
    )
      continue;
    context.emit({ t: 'interaction.closed', id: question.id, resolution: 'cancelled' });
  }
  await context.flush();
}

export async function supersedeQuestionInput(
  context: QuestionCancellationContext,
  input: MessageInput,
): Promise<MessageInput> {
  let recovered = false;
  new QuestionAnswers(context.db, context.owner).recover(context.state, (event) => {
    recovered = true;
    context.emit(event);
  });
  if (recovered) await context.flush();
  if (input.internal || input.privateText || !input.supersededQuestions?.length) return input;
  const questions = context.state.interactions.filter(
    (q): q is Question =>
      q.kind === 'question' &&
      input.supersededQuestions!.some(
        (ref) =>
          ref.id === q.id &&
          ref.request === JSON.stringify(q) &&
          ref.epoch === questionRequestEpoch(context.state, q),
      ),
  );
  const reason = `Superseded by owner message ${input.commandId ?? ''}`;
  if (questions.length) await cancelQuestionRequests(context, questions, reason);

  const retirements = new QuestionRetirements(context.db, context.owner);
  const recoveredProtected = input.supersededQuestions.filter(
    (ref) =>
      input.commandId &&
      ref.id.startsWith(TASK_SECRET_QUESTION_PREFIX) &&
      !questions.some((question) => question.id === ref.id) &&
      retirements.cancelledBy(ref, reason),
  );
  const superseded = [
    ...questions,
    ...recoveredProtected.map((ref) => JSON.parse(ref.request) as Question),
  ];
  if (!superseded.length) return input;
  const requests = superseded.map((q) => ({
    id: q.id,
    questions: q.questions.map((field) => field.text),
  }));
  const protectedForm = superseded.some((q) => q.id.startsWith(TASK_SECRET_QUESTION_PREFIX));
  return {
    ...input,
    text: withSkaroNote(
      'The owner replied in the composer and superseded these earlier requests: ' +
        JSON.stringify(requests) +
        '. Their fields were cancelled, not filled. Interpret the actual owner message as the new instruction. ' +
        'Do not repeat obsolete requests. Ask a new concrete question only if the new instruction leaves an indispensable decision unresolved.' +
        (protectedForm
          ? '\nA protected form was cancelled. Tell the owner in commentary before any tool call that ' +
            'chat did not submit the form. Never use or repeat credentials from this message. If the ' +
            'owner has not withdrawn the task or this request and protected values are still needed, ' +
            'call Skaro request_secret now with the fields still required and wait for the form answer. ' +
            'Opening replacement fields is part of answering this message and does not require resume_task ' +
            'or another message asking to continue. Do not end with a status-only acknowledgement.'
          : ''),
      input.text,
    ),
  };
}
