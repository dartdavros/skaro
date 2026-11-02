import { liveBudgetLedger } from '../credentials/live-budget-ledger';
import type { OpenRouterCatalogEntry } from '@skaro/agent-runtime';

/** Unknown request fee stays unknown. The wire request separately enforces max_price.request=0. */
export function requireConfiguredPlanPrice(pricing: OpenRouterCatalogEntry['pricing']) {
  if (pricing.prompt === null || pricing.completion === null)
    throw new Error('Configured plan token pricing is unknown');
  const prompt = Number(pricing.prompt),
    completion = Number(pricing.completion);
  if (
    !Number.isFinite(prompt) ||
    prompt < 0 ||
    prompt > 0.0000005 ||
    !Number.isFinite(completion) ||
    completion < 0 ||
    completion > 0.000002 ||
    (pricing.request !== null && Number(pricing.request) !== 0)
  )
    throw new Error('Configured plan price exceeds the requested gateway ceilings');
}

export interface ConfiguredPlanBudget {
  baseline: { requests: number; committedNanoUsd: number };
  additionalRequests: 5;
  ceilingNanoUsd: 950_000_000;
}
/** Owner-reviewed extension only. Existing acceptance's 80-intent guard is not changed. */
export function requireConfiguredPlanLedger(
  budget: ConfiguredPlanBudget,
  ledger: ConfiguredPlanBudget['baseline'],
) {
  if (
    !budget ||
    !budget.baseline ||
    Object.keys(budget).sort().join(',') !== 'additionalRequests,baseline,ceilingNanoUsd' ||
    Object.keys(budget.baseline).sort().join(',') !== 'committedNanoUsd,requests' ||
    !ledger ||
    Object.keys(ledger).sort().join(',') !== 'committedNanoUsd,requests'
  )
    throw new Error('Invalid reviewed configured budget');
  for (const value of [...Object.values(budget.baseline), ...Object.values(ledger)])
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error('Invalid configured live ledger');
  if (
    budget.additionalRequests !== 5 ||
    budget.ceilingNanoUsd !== 950_000_000 ||
    !Number.isSafeInteger(budget.baseline.requests + budget.additionalRequests)
  )
    throw new Error('Invalid reviewed configured budget');
  if (
    ledger.requests < budget.baseline.requests ||
    ledger.committedNanoUsd < budget.baseline.committedNanoUsd
  )
    throw new Error('Previous acceptance intents or holds were removed');
  if (
    ledger.requests > budget.baseline.requests + budget.additionalRequests ||
    ledger.committedNanoUsd > budget.ceilingNanoUsd
  )
    throw new Error('Reviewed configured acceptance budget exhausted');
}
export async function requireConfiguredPlanBudget(directory: string, budget: ConfiguredPlanBudget) {
  const ledger = await liveBudgetLedger(directory);
  requireConfiguredPlanLedger(budget, ledger);
  return ledger;
}
