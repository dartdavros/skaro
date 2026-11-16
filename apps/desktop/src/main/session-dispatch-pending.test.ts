import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { ownerDispatchPending } from './session-dispatch-pending';

it('projects only accepted or delivering input for the exact owner, without treating failures as work', () => {
  const db = AppDb.open(':memory:');
  try {
    db.commands.accept({
      id: 'input',
      owner: 'project:T-001',
      method: 'task.send',
      args: ['project', 'T-001', { text: 'Read-only instruction' }],
      state: 'accepted',
    });
    expect(ownerDispatchPending(db, 'project', 'T-001')).toBe(true);
    expect(ownerDispatchPending(db, 'other', 'T-001')).toBe(false);
    expect(ownerDispatchPending(db, 'project', 'T-002')).toBe(false);
    db.commands.update('input', 'delivering');
    expect(ownerDispatchPending(db, 'project', 'T-001')).toBe(true);
    for (const state of ['delivered', 'failed', 'uncertain', 'cancelled'] as const) {
      db.commands.update('input', state);
      expect(ownerDispatchPending(db, 'project', 'T-001')).toBe(false);
    }
  } finally {
    db.close();
  }
});
