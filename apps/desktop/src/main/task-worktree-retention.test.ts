import { expect, it } from 'vitest';
import { join } from 'node:path';
import {
  checkoutTaskIds,
  completedCheckout,
  restoredCheckoutInUse,
} from './worktree-retention-model';
import { historicalFileDiff } from './historical-file-diff';

it('protects all owners of a shared checkout without blocking cleanup for an unrelated task', () => {
  const path = join('worktrees', 'project', 'M01');
  expect([
    ...checkoutTaskIds(path, [
      { taskId: 'T-001', worktree: path },
      { taskId: 'T-002', worktree: path },
      { taskId: 'T-020', worktree: join('worktrees', 'project', 'T-020') },
    ]),
  ]).toEqual(['M01', 'T-001', 'T-002']);
});

it('never expires a legacy explicit working-copy handoff without verified consumer release', () => {
  const now = 200_000_000;
  const saved = { branch: 'skaro/T-001', head: 'saved', cleanedAt: now - 2000 };
  expect(restoredCheckoutInUse(null, 0, now)).toBe(false);
  expect(restoredCheckoutInUse(null, now - 1000, now)).toBe(true);
  expect(restoredCheckoutInUse(saved, now - 3000, now)).toBe(true);
  expect(restoredCheckoutInUse(saved, now - 1000, now + 86_400_000 * 365)).toBe(true);
});

it('preserves worktree-vs-HEAD semantics instead of inventing a commit-parent historical diff', () => {
  const saved = {
    branch: 'preserved',
    head: 'a'.repeat(40),
    trackedClean: {
      branch: 'preserved',
      head: 'a'.repeat(40),
      resourceId: 'resource',
      generation: 1,
      operationId: 'operation',
    },
  };
  expect(historicalFileDiff(saved, true)).toEqual({ status: 'unchanged', diff: '' });
  expect(() => historicalFileDiff(saved, false)).toThrow(
    'exact historical working-copy diff is unavailable',
  );
  expect(() => historicalFileDiff(undefined, true)).toThrow('unavailable');
  expect(() => historicalFileDiff({ branch: saved.branch, head: saved.head }, true)).toThrow(
    'unavailable',
  );
  expect(() => historicalFileDiff({ ...saved, head: 'b'.repeat(40) }, true)).toThrow('unavailable');
});

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
