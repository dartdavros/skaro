import { expect, it } from 'vitest';
import {
  requireConfiguredPlanLedger,
  requireConfiguredPlanPrice,
  type ConfiguredPlanBudget,
} from './verification/configured-plan-budget';
import { isLiveBudgetJournal } from './credentials/live-budget-ledger';

// Pure spend-ledger contracts, not receipts, provider replies or seeded project history.
it('retains old intent/hold floors and enforces both reviewed count and original USD margin', () => {
  const budget: ConfiguredPlanBudget = {
    baseline: { requests: 80, committedNanoUsd: 391_571_540 },
    additionalRequests: 5,
    ceilingNanoUsd: 950_000_000,
  };
  expect(() => requireConfiguredPlanLedger(budget, budget.baseline)).not.toThrow();
  expect(() =>
    requireConfiguredPlanLedger(budget, { requests: 85, committedNanoUsd: 950_000_000 }),
  ).not.toThrow();
  for (const ledger of [
    { requests: 79, committedNanoUsd: 391_571_540 },
    { requests: 80, committedNanoUsd: 0 },
  ])
    expect(() => requireConfiguredPlanLedger(budget, ledger)).toThrow('removed');
  for (const ledger of [
    { requests: 86, committedNanoUsd: 400_000_000 },
    { requests: 85, committedNanoUsd: 950_000_001 },
  ])
    expect(() => requireConfiguredPlanLedger(budget, ledger)).toThrow('exhausted');
  expect(() =>
    requireConfiguredPlanLedger(
      { ...budget, additionalRequests: 6 } as unknown as ConfiguredPlanBudget,
      budget.baseline,
    ),
  ).toThrow('Invalid reviewed');
});

it('keeps an unreported request fee unknown under an explicit zero gateway ceiling and refuses unknown token pricing', () => {
  const pricing = { prompt: '0.0000001', completion: '0.0000004', request: null };
  expect(() => requireConfiguredPlanPrice(pricing)).not.toThrow();
  expect(pricing.request).toBeNull();
  for (const value of [
    { ...pricing, prompt: null },
    { ...pricing, completion: null },
    { ...pricing, request: '0.01' },
    { ...pricing, prompt: '0.000001' },
  ])
    expect(() => requireConfiguredPlanPrice(value)).toThrow();
});

it('counts reviewed configured attempts in the existing ledger without excluding legacy sessions', () => {
  for (const name of [
    'session.jsonl',
    'session-nativeinput.jsonl',
    'session-configured-12345678-1234-1234-1234-123456789abc.jsonl',
  ])
    expect(isLiveBudgetJournal(name)).toBe(true);
  for (const name of [
    'session-configured-broken.jsonl',
    '../session.jsonl',
    'proof.json',
    'session-configured-12345678-1234-1234-1234-123456789abc.jsonl.old',
  ])
    expect(isLiveBudgetJournal(name)).toBe(false);
});
