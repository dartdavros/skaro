import { expect, it } from 'vitest';
import type { OwnerCommand } from '@skaro/timeline';
import {
  pendingOwnerCommand,
  retiredOwnerCommand,
  restoredCommandError,
} from './owner-command-state';

it('restores unresolved input but keeps the live echo after delivery until history loads', () => {
  for (const state of ['accepted', 'delivering', 'uncertain'] as const)
    expect(pendingOwnerCommand({ state })).toBe(true);
  for (const state of ['delivered', 'failed', 'cancelled'] as const)
    expect(pendingOwnerCommand({ state })).toBe(false);
  for (const state of ['accepted', 'delivering', 'uncertain', 'delivered'] as const)
    expect(retiredOwnerCommand({ state })).toBe(false);
  for (const state of ['failed', 'cancelled'] as const)
    expect(retiredOwnerCommand({ state })).toBe(true);
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
