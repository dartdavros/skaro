import { expect, it } from 'vitest';
import type { OwnerCommand } from '@skaro/timeline';
import {
  pendingOwnerCommand,
  retiredOwnerCommand,
  restoredCommandError,
  visibleOwnerCommand,
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

it('keeps internal diagnosis assignments out of live and restored owner echoes', () => {
  const command: OwnerCommand = {
    id: 'diagnose-incident',
    owner: 'project:task',
    method: 'task.send',
    args: ['project', 'task', { internal: true, text: 'Controller diagnosis' }],
    state: 'uncertain',
    error: 'Internal delivery interrupted',
  };
  expect(visibleOwnerCommand(command)).toBe(false);
  expect(pendingOwnerCommand(command)).toBe(false);
  expect(restoredCommandError([command])).toBeUndefined();
  const owner = { ...command, args: ['project', 'task', { text: 'Owner follow-up' }] };
  expect(visibleOwnerCommand(owner)).toBe(true);
  expect(pendingOwnerCommand(owner)).toBe(true);
  expect(restoredCommandError([owner])).toBe(command.error);
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
