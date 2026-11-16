import type { AppDb } from '@skaro/core';
import type { Interaction, InteractionAnswer } from '@skaro/timeline';
import type { ProjectDecision } from '../shared/project-decisions';
import { decisionHash } from './decision-projection';
import { withoutSecrets } from './session-log';

type Question = Extract<Interaction, { kind: 'question' }>;
const proofKey = (owner: string, question: Question, epoch?: string) =>
  `question.accepted.${owner}.${decisionHash([question, epoch ?? ''])}`;

/** Written in the same transaction as the mailbox, retained after delivery. No secret values. */
export function recordQuestionAcceptance(
  db: AppDb,
  owner: string,
  question: Question,
  answer: InteractionAnswer,
  epoch: string | undefined,
  deliveryId: string,
) {
  db.setSetting(proofKey(owner, question, epoch), {
    answer: decisionHash({ kind: 'respond', answer: withoutSecrets(question, answer) }),
    deliveryId,
  });
}

export function questionReplyProof(db: AppDb, entry: ProjectDecision, answerHash: string) {
  if (entry.kind !== 'interaction' || entry.interaction.kind !== 'question') return;
  if (entry.id.startsWith('coordinator:')) {
    const decision = db.coordination.decisions.get(entry.origin.projectId, entry.id.slice(12));
    // Coordinator questions have a separate durable acknowledgement in addition to subscribers.
    if (decision?.state === 'answered' && decision.evidence?.fingerprint === answerHash)
      return 'answered' as const;
    return;
  }
  let identity: unknown;
  try {
    identity = JSON.parse(entry.id);
  } catch {
    return;
  }
  if (!Array.isArray(identity) || identity.length !== 6) return;
  const integration = /^integration-([^:]+):/.exec(entry.interaction.id);
  const owner = integration
    ? `integration.${integration[1]}`
    : entry.origin.kind === 'task'
      ? `active.${entry.origin.epoch}`
      : `live.${entry.origin.id}`;
  const question = integration
    ? {
        ...entry.interaction,
        id: entry.interaction.id.slice(integration[0].length),
        ...(entry.interaction.itemId?.startsWith(integration[0])
          ? { itemId: entry.interaction.itemId.slice(integration[0].length) }
          : {}),
      }
    : entry.interaction;
  const requestEpoch =
    integration && typeof identity[3] === 'string' && identity[3].startsWith(integration[0])
      ? identity[3].slice(integration[0].length)
      : identity[3] || undefined;
  const proof = db.getSetting<{ answer: string; deliveryId: string } | undefined>(
    proofKey(owner, question, requestEpoch),
    undefined,
    { strict: true },
  );
  if (proof?.deliveryId && proof.answer === answerHash) return 'answered' as const;
  // Upgrade receipts written before the acceptance ledger existed, using exact saved evidence.
  const mailbox = db.getSetting<
    | {
        interaction: Question;
        answer: InteractionAnswer;
        requestEpoch?: string;
        deliveryId?: string;
      }[]
    | null
  >(`question.answers.${owner}`, null, { strict: true });
  if (
    mailbox?.some(
      (saved) =>
        saved.deliveryId &&
        saved.requestEpoch === requestEpoch &&
        decisionHash(saved.interaction) === decisionHash(question) &&
        decisionHash({ kind: 'respond', answer: saved.answer }) === answerHash,
    )
  )
    return 'answered' as const;
}
