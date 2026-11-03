import { expect, it } from 'vitest';
import {
  newSettingsAgent,
  BUILTIN_DEFAULT_RELEASED,
  BUILTIN_PRODUCT_RELEASED,
} from '@skaro/agents';
import { agentReady } from '../shared/ipc-entities';
import { parseBuiltinTaskStart } from './builtin-task-start';
import { parseBuiltinChatSettings } from './builtin-chat-settings';
import { environmentReviewInput } from '../../../../packages/agent-runtime/src/verification/owner-environment-review';
import {
  requireContinuationBudget,
  requireContinuationStep,
} from './verification/task-continuation-budget';
import { requireTaskWorkflowBudget } from './verification/task-workflow-budget';

it('keeps BYOK caps optional and rejects invalid supplied values in task and chat selections', () => {
  const chat = { agent: 'skaro', model: 'explicit-route', permissionMode: 'ask' };
  const task = { ...chat, planFirst: false, isolation: 'in-place' };
  expect(parseBuiltinChatSettings(chat).budgetUsd).toBeUndefined();
  expect(parseBuiltinTaskStart({ ...task, budgetUsd: 0.1 }).budgetUsd).toBe(0.1);
  for (const budgetUsd of [0, -1, Infinity, NaN, '1']) {
    expect(() => parseBuiltinTaskStart({ ...task, budgetUsd })).toThrow();
    expect(() => parseBuiltinChatSettings({ ...chat, budgetUsd })).toThrow();
  }
});

it('keeps the default release gate closed and never substitutes an existing owner choice', () => {
  expect(BUILTIN_DEFAULT_RELEASED).toBe(false);
  expect(BUILTIN_PRODUCT_RELEASED).toBe(false);
  expect(
    agentReady({
      id: 'skaro',
      installed: true,
      authenticated: true,
      inDevelopment: true,
      sizeBytes: 0,
    }),
  ).toBe(false);
  expect(newSettingsAgent(undefined)).toBe('claude-code');
  expect(newSettingsAgent(undefined, true)).toBe('skaro');
  for (const saved of ['claude-code', 'codex', 'skaro'] as const)
    expect(newSettingsAgent(saved, true)).toBe(saved);
});

it('accepts environment review proposals only as references and explicit assumptions, never as host authority', () => {
  const proposal = { evidence: [{ sequence: 1, hash: 'a'.repeat(64) }], assumptions: [] };
  expect(environmentReviewInput.safeParse(proposal).success).toBe(true);
  expect(environmentReviewInput.safeParse({ ...proposal, approved: true }).success).toBe(false);
  expect(
    environmentReviewInput.safeParse({ ...proposal, dependencies: 'a'.repeat(64) }).success,
  ).toBe(false);
  expect(environmentReviewInput.safeParse({ ...proposal, evidence: [] }).success).toBe(false);
});

it('retains old spend and holds and refuses the next intent or reservation beyond the continuation grant', () => {
  const proposal = {
    baseline: { requests: 129, committedNanoUsd: 460_686_901 },
    additionalRequests: 40,
    requestCeiling: 169,
    ceilingNanoUsd: 950_000_000,
    totalOwnerLimitUsd: 1,
    unknownHoldsRetained: true,
    proxy: 'http://127.0.0.1:10809',
    directFallback: false,
  };
  expect(() => requireContinuationStep(proposal, proposal.baseline)).not.toThrow();
  expect(() => requireTaskWorkflowBudget(proposal, proposal.baseline)).toThrow();
  expect(() =>
    requireContinuationBudget(proposal, { requests: 130, committedNanoUsd: 460_686_900 }),
  ).toThrow();
  expect(() =>
    requireContinuationBudget(
      proposal,
      { requests: 130, committedNanoUsd: 940_000_000 },
      10_000_001,
    ),
  ).toThrow();
  expect(() =>
    requireContinuationStep(proposal, { requests: 169, committedNanoUsd: 500_000_000 }),
  ).toThrow();
  expect(() =>
    requireContinuationBudget(proposal, { requests: 170, committedNanoUsd: 500_000_000 }),
  ).toThrow();
});
