import { withSkaroNote } from '@skaro/timeline';
import { createHash } from 'node:crypto';
import type { ChatEngine } from './chat-engine';
import type { LiveChat, ProposalItem } from './chat-model';

export const chatC4FeedbackId = (note: string) =>
  `c4-feedback-${createHash('sha256').update(note).digest('hex')}`;

/** A pending receipt is a snapshot; the confirmed owner outcome supersedes it in the same turn. */
export function chatC4DecisionNote(previous: ProposalItem | undefined, item: ProposalItem) {
  if (
    previous?.proposal.type !== 'architecture' ||
    !['pending', 'accepted'].includes(previous.state) ||
    item.proposal.type !== 'architecture' ||
    !(
      ['applied', 'rejected'].includes(item.state) ||
      (item.state === 'accepted' && item.result?.error)
    )
  )
    return;
  const facts = JSON.stringify({
    packageId: item.id,
    state: item.state,
    ...(item.result?.error ? { applicationError: item.result.error } : {}),
  });
  return (
    `Skaro confirmed the current C4 decision: ${facts}. This supersedes the earlier pending ` +
    'tool receipt. The package no longer awaits owner acceptance. ' +
    (item.state === 'applied'
      ? 'The package has been applied. Read get_c4_context before reporting its current state or continuing the already authorized dependent work.'
      : item.state === 'rejected'
        ? 'The owner rejected it. Do not apply or propose it again without a new explicit owner instruction.'
        : 'The owner accepted it, but application needs recovery. Report the application error, not a missing owner decision.')
  );
}

/** Durable notes also cover idle/closed sessions; strict steering never starts another turn. */
export function notifyChatC4Decision(
  ctx: ChatEngine,
  live: LiveChat,
  previous: ProposalItem | undefined,
  item: ProposalItem,
) {
  const note = chatC4DecisionNote(previous, item);
  if (!note) return;
  ctx.proposals.addNotes(live.chat.id, [note]);
  const session = live.session;
  if (
    !session ||
    ctx.closing ||
    live.stopping ||
    live.operation.signal.aborted ||
    live.timeline.state.status === 'idle' ||
    live.timeline.state.turns.at(-1)?.outcome
  )
    return;
  void session
    .steer(
      { text: withSkaroNote(`context_update: c4\n${note}`, ''), onlyActiveTurn: true },
      chatC4FeedbackId(note),
    )
    .catch((error: unknown) => console.error('Project chat C4 feedback deferred:', error));
}
