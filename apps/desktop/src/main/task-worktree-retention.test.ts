import { expect, it } from 'vitest';
import { completedCheckout } from './task-worktree-retention';

it('requires completed owners and never treats missing or unfinished metadata as garbage', () => {
  expect(completedCheckout([], 'T-001')).toBe(false);
  for (const status of ['todo', 'in_progress', 'review', 'failed', 'cancelled'] as const)
    expect(completedCheckout([{ id: 'T-001', status }], 'T-001')).toBe(false);
  expect(completedCheckout([{ id: 'T-001', status: 'done' }], 'T-001')).toBe(true);
  expect(
    completedCheckout(
      [
        { id: 'T-001', status: 'done', milestone: 'M01' },
        { id: 'T-002', status: 'review', milestone: 'M01' },
      ],
      'M01',
    ),
  ).toBe(false);
  expect(
    completedCheckout(
      [
        { id: 'T-001', status: 'done', milestone: 'M01' },
        { id: 'T-002', status: 'done', milestone: 'M01' },
      ],
      'M01',
    ),
  ).toBe(true);
});
