import { isDeepStrictEqual } from 'node:util';
import { initializedReconciliationIntent } from './cache-verification-reconciliation-initialized';

/** Exact retained failure only; no guessed argv/stderr, and no claim fetch was never dispatched. */
export function initializedReconciliationProducerFailure(proof: Record<string, unknown>) {
  const descriptor = initializedReconciliationIntent(proof.intentId);
  if (
    !descriptor ||
    typeof proof.error !== 'string' ||
    !proof.error.startsWith('Error: managed_pnpm_fetch_failed_exit_1_unreported\n') ||
    !isDeepStrictEqual(proof.dependencyOperations, [])
  )
    throw new Error('cache_reconciliation_initialized_failed_producer_proof');
  return descriptor.failure;
}
