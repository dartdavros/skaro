import assert from 'node:assert/strict';
import type { TaskStopReview } from './task-stop-review';

/** Separate four-request proposal; does not extend any older acceptance grant. */
export function requireTaskStopBudget(
  budget: TaskStopReview['budgetProposal'],
  ledger: { requests: number; committedNanoUsd: number },
) {
  assert.deepEqual(Object.keys(budget).sort(), [
    'additionalRequests',
    'baseline',
    'ceilingNanoUsd',
    'requestCeiling',
    'totalOwnerLimitUsd',
    'unknownHoldsRetained',
  ]);
  assert.deepEqual(budget.baseline, { requests: 85, committedNanoUsd: 393_241_240 });
  assert.equal(budget.additionalRequests, 4);
  assert.equal(budget.requestCeiling, 89);
  assert.equal(budget.ceilingNanoUsd, 950_000_000);
  assert.equal(budget.totalOwnerLimitUsd, 1);
  assert.equal(budget.unknownHoldsRetained, true);
  assert.deepEqual(Object.keys(ledger).sort(), ['committedNanoUsd', 'requests']);
  for (const value of Object.values(ledger)) assert(Number.isSafeInteger(value));
  assert(ledger.requests >= budget.baseline.requests && ledger.requests <= budget.requestCeiling);
  assert(ledger.committedNanoUsd >= budget.baseline.committedNanoUsd);
  assert(ledger.committedNanoUsd <= budget.ceilingNanoUsd);
}
