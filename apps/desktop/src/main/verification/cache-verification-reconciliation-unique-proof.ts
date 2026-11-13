import { isDeepStrictEqual } from 'node:util';

/** Actual immutable proof has a generic command error, NOT recorded stderr/argv/parser diagnostics. */
export function uniqueReconciliationProducerFailure(proof: Record<string, unknown>) {
  if (
    typeof proof.error !== 'string' ||
    !proof.error.startsWith('Error: managed_cache_command_failed\n') ||
    !isDeepStrictEqual(proof.dependencyOperations, [])
  )
    throw new Error('cache_reconciliation_unique_failed_producer_proof');
  // Closure/domain ownership is separately bound to the original host consumer + retained outcome;
  // complete accounting and exact no-store/empty-target physical shape must independently follow.
  return 'prefetch-command' as const;
}
