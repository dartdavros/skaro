import { expect, it } from 'vitest';
import { AppDb } from './appdb.ts';

it('keeps the old unknown receipt in the journal when a new owner instruction is accepted', () => {
  const db = AppDb.open(':memory:');
  try {
    const owner = 'project:task';
    const accept = (id: string, internal = false) =>
      db.commands.accept({
        id,
        owner,
        method: 'task.send',
        args: ['project', 'task', { text: id, internal }],
        state: 'accepted',
      });
    accept('old');
    db.commands.update('old', 'uncertain', 'Old acknowledgement missing');
    accept('diagnosis', true);
    db.commands.update('diagnosis', 'delivered');
    expect(db.commands.forDisplay(owner).map((c) => c.id)).toEqual(['old']);
    accept('resume');
    expect(db.commands.forDisplay(owner).map((c) => c.id)).toEqual(['resume']);
    db.commands.update('resume', 'delivered');
    expect(db.commands.forDisplay(owner)).toEqual([]);
    expect(db.commands.get('old')?.state).toBe('uncertain');
  } finally {
    db.close();
  }
});
