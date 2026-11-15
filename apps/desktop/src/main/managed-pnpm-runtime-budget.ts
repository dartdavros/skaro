import { CACHE_BYTE_LIMIT } from './managed-cache-files';

/** Bound archive expansion safely; cache retention policy never gates publication. */
export function pnpmRuntimeAccountedBytes(current: number, expanded: number, budget: number) {
  if (![current, expanded, budget].every((value) => Number.isSafeInteger(value) && value >= 0))
    throw new Error('managed_pnpm_runtime_accounting_invalid');
  const total = current + expanded;
  if (!Number.isSafeInteger(total) || total > CACHE_BYTE_LIMIT)
    throw new Error('managed_dependencies_expansion_limit');
  return total;
}
