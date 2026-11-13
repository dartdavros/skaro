import type { AppDb } from '@skaro/core';
import type { DecisionAnswer, ProjectDecision } from '../shared/project-decisions';
import type { C4ProposalRecord } from './c4-service';
import { coordinationHash } from './project-coordinator-request';

interface Reply {
  revision: string;
  answer: string;
  outcome: string;
  state: 'dispatching' | 'done' | 'uncertain';
}
interface Link extends Omit<Reply, 'state'> {
  key: string;
  action: 'apply' | 'reject';
  effectHash: string;
}
const key = (project: string, id: string) => `c4.owner-reply.${project}.${id}`;

/** The exact original answer is linked before dispatch; recovery never manufactures consent. */
export function linkC4DecisionReply(
  db: AppDb,
  entry: ProjectDecision,
  answer: DecisionAnswer,
  receiptKey: string,
  receipt: Reply,
) {
  if (
    entry.kind !== 'proposal' ||
    entry.item.proposal.type !== 'architecture' ||
    answer.kind !== 'proposal' ||
    answer.action.action === 'revert'
  )
    return;
  const project = entry.origin.projectId,
    id = entry.item.id;
  const action = answer.action.action;
  const link: Link = {
    key: receiptKey,
    revision: receipt.revision,
    answer: receipt.answer,
    outcome: receipt.outcome,
    action,
    effectHash: coordinationHash([
      project,
      id,
      action,
      action === 'apply' ? answer.action.fingerprint : undefined,
    ]),
  };
  const prior = db.getSetting<Link | undefined>(key(project, id), undefined, { strict: true });
  if (prior && JSON.stringify(prior) !== JSON.stringify(link))
    throw new Error('Original C4 decision receipt changed');
  if (!prior && !db.settings.compareAndSet(key(project, id), undefined, link))
    throw new Error('C4 decision receipt changed');
}

/** Only the existing executor's verified terminal record closes a lost owner/IPC receipt. */
export function recoverC4DecisionReply(db: AppDb, record: C4ProposalRecord) {
  const project = record.scope.projectId,
    id = record.item.id;
  const link = db.getSetting<Link | undefined>(key(project, id), undefined, { strict: true });
  if (!link || record.item.state !== (link.action === 'apply' ? 'applied' : 'rejected')) return;
  const receipt = db.getSetting<Reply | undefined>(link.key, undefined, { strict: true });
  if (
    !receipt ||
    receipt.revision !== link.revision ||
    receipt.answer !== link.answer ||
    receipt.outcome !== link.outcome
  )
    throw new Error('C4 recovery answer identity changed');
  const operations = db.coordination
    .pending(project)
    .filter(
      (op) =>
        op.state === 'uncertain' &&
        op.subject.kind === 'decision' &&
        op.subject.id === id &&
        op.action === 'ipc.c4.decide' &&
        op.inputHash === link.effectHash,
    );
  // A normal foreground dispatcher still owns its CAS; do not race its successful completion.
  if (!operations.length && receipt.state !== 'uncertain') return;
  for (const operation of operations)
    db.coordination.reconcile(project, operation.id, {
      expectedRevision: operation.revision,
      state: 'succeeded',
      evidence: {
        code: 'c4_original_decision_verified',
        refs: [{ kind: 'decision', id }],
        fingerprint: link.effectHash,
      },
    });
  if (
    receipt.state !== 'done' &&
    !db.settings.compareAndSet(link.key, receipt, { ...receipt, state: 'done' })
  )
    throw new Error('C4 reply recovery changed');
}
