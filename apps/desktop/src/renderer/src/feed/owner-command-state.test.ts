import { expect, it } from 'vitest';
import type { OwnerCommand } from '@skaro/timeline';
import { pendingOwnerCommand, restoredCommandError } from './owner-command-state';

it('restores only unresolved input and retires the echo on delivery, failure or cancellation', () => {
  for (const state of ['accepted', 'delivering', 'uncertain'] as const)
    expect(pendingOwnerCommand({ state })).toBe(true);
  for (const state of ['delivered', 'failed', 'cancelled'] as const)
    expect(pendingOwnerCommand({ state })).toBe(false);
});

it('does not resurrect a failed command banner but preserves an unresolved delivery warning', () => {
  const failed: OwnerCommand = {
    id: 'old-input',
    owner: 'project:task',
    method: 'task.send',
    args: [],
    state: 'failed',
    error: 'EPERM: rename',
  };
  expect(restoredCommandError([failed])).toBeUndefined();
  expect(
    restoredCommandError([
      failed,
      { ...failed, id: 'interrupted', state: 'uncertain', error: 'Delivery was interrupted' },
    ]),
  ).toBe('Delivery was interrupted');
});
