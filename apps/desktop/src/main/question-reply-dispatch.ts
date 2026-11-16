import { AsyncLocalStorage } from 'node:async_hooks';
import type { AppDb, CoordinationRef } from '@skaro/core';
import type { InteractionAnswer } from '@skaro/timeline';
import type { ProjectDecision } from '../shared/project-decisions';
import type { ProjectCoordinators } from './project-coordinators';
import { decisionHash } from './decision-projection';
import { withoutSecrets } from './session-log';
import { questionReplyProof } from './question-answer-proof';

interface QuestionReply {
  entry: ProjectDecision;
  answerHash: string;
}
const dispatch = new AsyncLocalStorage<QuestionReply>();
export function currentQuestionReply(project: string, subject: CoordinationRef) {
  const question = dispatch.getStore();
  return question?.entry.origin.projectId === project &&
    question.entry.origin.id === subject.id &&
    question.entry.origin.kind === subject.kind
    ? question
    : undefined;
}
export function dispatchQuestionReply<T>(
  entry: ProjectDecision,
  answer: InteractionAnswer,
  effect: () => T,
): T {
  if (entry.kind !== 'interaction' || entry.interaction.kind !== 'question') return effect();
  return dispatch.run(
    {
      entry,
      answerHash: decisionHash({
        kind: 'respond',
        answer: withoutSecrets(entry.interaction, answer),
      }),
    },
    effect,
  );
}

/** Reconcile only exact durable acceptance or a known pre-dispatch refusal; native uncertainty stays fenced. */
export function settleQuestionReplyError(
  db: AppDb,
  coordinators: ProjectCoordinators,
  question: QuestionReply | undefined,
  project: string,
  operation: string,
  subject: CoordinationRef,
  error: unknown,
) {
  if (question && db.coordination.getOperation(project, operation)?.state === 'uncertain') {
    if (questionReplyProof(db, question.entry, question.answerHash) === 'answered') {
      coordinators.reconcile(
        project,
        operation,
        { code: 'question_acceptance_verified', refs: [subject], fingerprint: question.answerHash },
        'succeeded',
      );
      return;
    }
  }
  throw error;
}
