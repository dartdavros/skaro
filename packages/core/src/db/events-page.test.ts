import { expect, it } from 'vitest';
import { AppDb } from './appdb.ts';
it('pages the actual SQLite project ledger by stable keys without losing or mixing events', () => {
  const db = AppDb.open(':memory:');
  try {
    // Actual SQLite scope metadata referencing existing folders; no live project or backend seed.
    const project = db.addProject({ name: 'Observed repository', path: process.cwd() });
    const separate = db.addProject({
      name: 'Separate scope metadata',
      path: process.cwd() + '/packages/core',
    });
    for (let index = 0; index < 4; index++) db.addEvent(project.id, 'protocol.observed', { index });
    db.addEvent(separate.id, 'protocol.observed', {});
    const first = db.events.page(project.id, undefined, 2);
    db.addEvent(project.id, 'protocol.observed', { index: 4 });
    const second = db.events.page(project.id, first.nextCursor, 2);
    expect([...first.events, ...second.events].map((row) => row.data.index)).toEqual([3, 2, 1, 0]);
    expect(second.nextCursor).toBeUndefined();
    expect(() => db.events.page(project.id, -1)).toThrow('Invalid event page');
  } finally {
    db.close();
  }
});
