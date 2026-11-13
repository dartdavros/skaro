import type { VerificationArchiveHostGate } from './verification-archive-guards.ts';

export type ArchiveWrite = <T>(effect: () => T) => T;
export function archiveTransactionState(actual: boolean, expected: boolean): void {
  if (actual !== expected) throw new Error('verification_archive_transaction_changed');
}
/** One synchronous host authorization per mutating statement, never a batch approval. */
export function archiveWriteStep<T>(gate: VerificationArchiveHostGate, effect: () => T): T {
  if (typeof gate !== 'function') throw new Error('verification_archive_host_gate_required');
  const result: unknown = gate();
  if (result && typeof (result as { then?: unknown }).then === 'function')
    throw new Error('verification_archive_async_host_gate');
  return effect();
}
/** No await or nested archive transaction; failed authorization/effect never reaches COMMIT. */
export function archiveWriteTransaction(
  write: ArchiveWrite,
  begin: () => void,
  body: (write: ArchiveWrite) => void,
  commit: () => void,
  rollback: () => void,
): void {
  try {
    write(begin);
    body(write);
    write(commit);
  } catch (error) {
    // Rollback is a safety effect, not another authorization request. Preserve the original cause.
    try {
      rollback();
    } catch {
      /* A rollback failure cannot replace the refusal/write error. */
    }
    throw error;
  }
}
