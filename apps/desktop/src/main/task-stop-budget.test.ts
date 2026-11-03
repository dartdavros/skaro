import { describe, expect, it } from 'vitest';
import { requireTaskStopBudget } from './verification/task-stop-budget';
import type { TaskStopReview } from './verification/task-stop-review';

const proposal: TaskStopReview['budgetProposal'] = {
  baseline: { requests: 85, committedNanoUsd: 393_241_240 },
  additionalRequests: 4,
  requestCeiling: 89,
  ceilingNanoUsd: 950_000_000,
  totalOwnerLimitUsd: 1,
  unknownHoldsRetained: true,
};

describe('separately reviewed T-006 Stop budget', () => {
  it('retains the old baseline and bounds both new intents and total held expenses', () => {
    expect(() => requireTaskStopBudget(proposal, proposal.baseline)).not.toThrow();
    expect(() =>
      requireTaskStopBudget(proposal, { requests: 89, committedNanoUsd: 950_000_000 }),
    ).not.toThrow();
    for (const ledger of [
      { requests: 84, committedNanoUsd: 393_241_240 },
      { requests: 85, committedNanoUsd: 393_241_239 },
      { requests: 90, committedNanoUsd: 393_241_240 },
      { requests: 86, committedNanoUsd: 950_000_001 },
      { requests: 85.5, committedNanoUsd: 393_241_240 },
    ])
      expect(() => requireTaskStopBudget(proposal, ledger)).toThrow();
  });
  it('refuses a different extension, baseline or raised ceiling', () => {
    for (const changed of [
      { ...proposal, additionalRequests: 5 },
      { ...proposal, requestCeiling: 90 },
      { ...proposal, ceilingNanoUsd: 1_000_000_000 },
      { ...proposal, unknownHoldsRetained: false },
      { ...proposal, baseline: { ...proposal.baseline, requests: 80 } },
      { ...proposal, extra: true },
    ])
      expect(() => requireTaskStopBudget(changed, proposal.baseline)).toThrow();
  });
});
