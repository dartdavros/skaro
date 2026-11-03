import assert from 'node:assert/strict';
import type { TaskWorkflowBudget } from './task-workflow-budget';

/** Owner extension of 03.11.2026. Historical grants and every previous hold remain intact. */
export function requireContinuationBudget(
  proposal: TaskWorkflowBudget,
  ledger: TaskWorkflowBudget['baseline'],
  reservation = 0,
) {
  assert.deepEqual(proposal, {
    baseline: { requests: 129, committedNanoUsd: 460_686_901 },
    additionalRequests: 40,
    requestCeiling: 169,
    ceilingNanoUsd: 950_000_000,
    totalOwnerLimitUsd: 1,
    unknownHoldsRetained: true,
    proxy: 'http://127.0.0.1:10809',
    directFallback: false,
  });
  assert.deepEqual(Object.keys(ledger).sort(), ['committedNanoUsd', 'requests']);
  for (const value of [...Object.values(ledger), reservation])
    assert(Number.isSafeInteger(value) && value >= 0, 'Invalid continuation budget');
  assert(ledger.requests >= 129 && ledger.requests <= 169, 'Continuation request count exceeded');
  assert(ledger.committedNanoUsd >= proposal.baseline.committedNanoUsd);
  assert(
    ledger.committedNanoUsd + reservation <= proposal.ceilingNanoUsd,
    'Total USD cap exceeded',
  );
}

export function requireContinuationStep(
  proposal: TaskWorkflowBudget,
  ledger: TaskWorkflowBudget['baseline'],
) {
  requireContinuationBudget(proposal, ledger);
  assert(ledger.requests < proposal.requestCeiling, 'Stop before the next unreviewed intent');
}
