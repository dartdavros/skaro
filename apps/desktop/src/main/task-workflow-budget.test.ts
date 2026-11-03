import { describe, expect, it } from 'vitest';
import {
  requireTaskWorkflowBudget,
  requireTaskWorkflowStep,
} from './verification/task-workflow-budget';

const proposal = {
  baseline: { requests: 89, committedNanoUsd: 428_414_440 },
  additionalRequests: 40,
  requestCeiling: 129,
  ceilingNanoUsd: 950_000_000,
  totalOwnerLimitUsd: 1,
  unknownHoldsRetained: true,
  proxy: 'http://127.0.0.1:10809',
  directFallback: false,
};

describe('owner-reviewed workflow budget extension', () => {
  it('allows dispatch of intent 129 but stops before constructing intent 130', () => {
    const ledger = { requests: 129, committedNanoUsd: 500_000_000 };
    expect(() => requireTaskWorkflowBudget(proposal, ledger)).not.toThrow();
    expect(() => requireTaskWorkflowStep(proposal, ledger)).toThrow();
    expect(() => requireTaskWorkflowStep(proposal, { ...ledger, requests: 128 })).not.toThrow();
  });
  it('retains all old charges and bounds the total including the proposed reservation', () => {
    expect(() => requireTaskWorkflowBudget(proposal, proposal.baseline)).not.toThrow();
    const ledger = { requests: 129, committedNanoUsd: 940_000_000 };
    expect(() => requireTaskWorkflowBudget(proposal, ledger, 10_000_000)).not.toThrow();
    expect(() => requireTaskWorkflowBudget(proposal, ledger, 10_000_001)).toThrow();
    for (const invalid of [
      { requests: 88, committedNanoUsd: 428_414_440 },
      { requests: 89, committedNanoUsd: 428_414_439 },
      { requests: 130, committedNanoUsd: 428_414_440 },
      { requests: 90, committedNanoUsd: 950_000_001 },
      { requests: 90.5, committedNanoUsd: 428_414_440 },
    ])
      expect(() => requireTaskWorkflowBudget(proposal, invalid)).toThrow();
    for (const amount of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER])
      expect(() => requireTaskWorkflowBudget(proposal, ledger, amount)).toThrow();
  });

  it('rejects widening the review, changing routing or discarding unknown holds', () => {
    for (const changed of [
      { ...proposal, requestCeiling: 130 },
      { ...proposal, additionalRequests: 41 },
      { ...proposal, ceilingNanoUsd: 1_000_000_000 },
      { ...proposal, totalOwnerLimitUsd: 2 },
      { ...proposal, unknownHoldsRetained: false },
      { ...proposal, directFallback: true },
      { ...proposal, proxy: '' },
      { ...proposal, baseline: { ...proposal.baseline, requests: 0 } },
      { ...proposal, extra: true },
    ])
      expect(() => requireTaskWorkflowBudget(changed, proposal.baseline)).toThrow();
  });
});
