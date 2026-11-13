import type { C4Audit } from '../shared/c4-audit';
import type { C4ProposalRecord } from './c4-service';
import type { C4AuditStore } from './c4-audit-store';
import type { AppDb } from '@skaro/core';

export const auditReceiptKey = (id: string) => `c4.audit.receipt.${id}`;
export const auditEndKey = (id: string) => `c4.audit.end.${id}`;
export interface AuditReceipt {
  result: 'unchanged' | 'partial';
  summary: string;
  fingerprint: string;
}
/** Proposal state is authoritative; finishing the chat cannot invent physical application success. */
export function reconcileC4Audit(
  store: C4AuditStore,
  db: AppDb,
  audit: C4Audit,
  records: C4ProposalRecord[],
) {
  const owned = records.filter((r) => r.scope.chatId === audit.chatId);
  const pending = owned.find((r) => r.item.state === 'pending');
  const accepted = owned.find((r) => r.item.state === 'accepted');
  if (accepted)
    return store.update(audit, {
      state: accepted.item.result?.error ? 'conflict' : 'applying',
      packageId: accepted.item.id,
      error: accepted.item.result?.error,
    });
  if (pending)
    return store.update(audit, { state: 'decision', packageId: pending.item.id, error: undefined });
  const applied = owned.find((r) => r.item.state === 'applied');
  const rejected = owned.find((r) => r.item.state === 'rejected');
  if (applied || rejected)
    return store.update(audit, {
      state: 'done',
      result: applied ? 'applied' : 'rejected',
      packageId: (applied ?? rejected)!.item.id,
      error: undefined,
    });
  if (audit.state === 'stopped' || audit.state === 'stopping') return audit;
  const end = db.getSetting<{ outcome: string; error?: string } | undefined>(
    auditEndKey(audit.id),
    undefined,
  );
  if (!end) return audit;
  const receipt = db.getSetting<AuditReceipt | undefined>(auditReceiptKey(audit.id), undefined);
  if (end.outcome !== 'done' || !receipt)
    return store.update(audit, {
      state: 'error',
      error: end.error ?? 'Аудит завершился без проверяемого результата.',
    });
  return store.update(audit, {
    state: receipt.result === 'partial' ? 'partial' : 'done',
    result: receipt.result,
    summary: receipt.summary,
    error: undefined,
  });
}
