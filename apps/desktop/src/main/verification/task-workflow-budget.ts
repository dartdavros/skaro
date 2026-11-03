import assert from 'node:assert/strict';

export interface TaskWorkflowBudget {
  baseline: { requests: number; committedNanoUsd: number };
  additionalRequests: number;
  requestCeiling: number;
  ceilingNanoUsd: number;
  totalOwnerLimitUsd: number;
  unknownHoldsRetained: boolean;
  proxy: string;
  directFallback: boolean;
}

/** Independent extension; never alters the historical 80/85/89 grants. */
export function requireTaskWorkflowBudget(
  proposal: TaskWorkflowBudget,
  ledger: TaskWorkflowBudget['baseline'],
  proposedReservationNanoUsd = 0,
) {
  assert.deepEqual(proposal, {
    baseline: { requests: 89, committedNanoUsd: 428_414_440 },
    additionalRequests: 40,
    requestCeiling: 129,
    ceilingNanoUsd: 950_000_000,
    totalOwnerLimitUsd: 1,
    unknownHoldsRetained: true,
    proxy: 'http://127.0.0.1:10809',
    directFallback: false,
  });
  assert.deepEqual(Object.keys(ledger).sort(), ['committedNanoUsd', 'requests']);
  for (const value of [...Object.values(ledger), proposedReservationNanoUsd])
    assert(Number.isSafeInteger(value) && value >= 0, 'Invalid workflow budget value');
  assert(ledger.requests >= proposal.baseline.requests && ledger.requests <= 129);
  assert(ledger.committedNanoUsd >= proposal.baseline.committedNanoUsd);
  // Reserve is called after the durable intent: its request is already in this count.
  // Conservatively retain even that intent's unknown hold until a receipt replaces it.
  assert(ledger.committedNanoUsd + proposedReservationNanoUsd <= proposal.ceilingNanoUsd);
}

/** Tool selection runs before modelStep persists the next intent. */
export function requireTaskWorkflowStep(
  proposal: TaskWorkflowBudget,
  ledger: TaskWorkflowBudget['baseline'],
) {
  requireTaskWorkflowBudget(proposal, ledger);
  assert(
    ledger.requests < proposal.requestCeiling,
    'Stop before creating an intent beyond the reviewed request count',
  );
}
