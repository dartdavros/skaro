import { expect, it } from 'vitest';
import { GraphStore } from './store';
import { pruneSnapshots } from './store-prune';

it('removes every row of expired snapshots, not only what fits a time budget', async () => {
  // In-memory database; no files, services or generated project data.
  const store = new GraphStore(':memory:');
  const { db } = store;
  const rows = 12_000;
  for (const id of ['old', 'previous', 'current']) {
    db.prepare('INSERT INTO snapshots VALUES(?,?)').run(id, '{}');
    db.exec('BEGIN');
    const node = db.prepare('INSERT INTO nodes(snapshot,id,name) VALUES(?,?,?)');
    const edge = db.prepare('INSERT INTO edges(snapshot,id,source,target) VALUES(?,?,?,?)');
    const search = db.prepare('INSERT INTO search(snapshot,id,name) VALUES(?,?,?)');
    for (let i = 0; i < rows; i++) {
      node.run(id, `n${i}`, `name${i}`);
      edge.run(id, `e${i}`, `n${i}`, `n${i + 1}`);
      search.run(id, `n${i}`, `name${i}`);
    }
    db.prepare('INSERT INTO unresolved VALUES(?,?,?)').run(id, 'n0', '{}');
    db.exec('COMMIT');
  }
  await pruneSnapshots(db, ['current', 'previous']);
  const count = (table: string) =>
    db
      .prepare(`SELECT snapshot, count(*) n FROM ${table} GROUP BY snapshot ORDER BY snapshot`)
      .all();
  for (const table of ['nodes', 'edges', 'search'])
    expect(count(table)).toEqual([
      { snapshot: 'current', n: rows },
      { snapshot: 'previous', n: rows },
    ]);
  expect(count('unresolved')).toEqual([
    { snapshot: 'current', n: 1 },
    { snapshot: 'previous', n: 1 },
  ]);
  expect(db.prepare('SELECT * FROM garbage').all()).toEqual([]);
});
