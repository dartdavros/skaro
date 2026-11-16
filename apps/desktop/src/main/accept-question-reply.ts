import type { AppDb } from '@skaro/core';
import type { Interaction, InteractionAnswer, TimelineState, TimelineEvent } from '@skaro/timeline';
import { QuestionAnswers } from './question-answers';

/** Queue from the committed projection even if writing its presentation event fails. */
export function acceptQuestionReply(
  db: AppDb,
  owner: string,
  question: Extract<Interaction, { kind: 'question' }>,
  answer: InteractionAnswer,
  state: TimelineState,
  emit: (event: TimelineEvent) => void,
  method: 'chat.send' | 'task.send',
  project: string,
  conversation: string,
) {
  const mailbox = new QuestionAnswers(db, owner);
  mailbox.accept(question, answer, emit, state.turns.at(-1)?.id, undefined, () =>
    mailbox.queue(method, project, conversation, mailbox.project(state)),
  );
}
