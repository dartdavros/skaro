import { CACHE_BYTE_LIMIT } from './managed-cache-files';

/** Precharge bounded expansion before writing; sweep separately admits aggregate cache capacity. */
export function pnpmRuntimeAccountedBytes(current: number, expanded: number, budget: number) {
  if (![current, expanded, budget].every((value) => Number.isSafeInteger(value) && value >= 0))
    throw new Error('managed_pnpm_runtime_accounting_invalid');
  const total = current + expanded;
  if (!Number.isSafeInteger(total) || total > Math.min(budget, CACHE_BYTE_LIMIT))
    throw new Error('managed_dependencies_budget_retained');
  return total;
}
