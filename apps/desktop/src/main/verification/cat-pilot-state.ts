import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { AppState } from '../state';

/** Choose real registry metadata before AppState reset/recovery/watchers can touch another project. */
export function catPilotState(data: string) {
  const file = join(data, 'skaro.db');
  const registry = new DatabaseSync(file, { readOnly: true });
  let projectId: string;
  try {
    const rows = registry
      .prepare('SELECT id FROM projects WHERE name=? COLLATE NOCASE')
      .all('Cat-pilot') as { id: string }[];
    assert.equal(rows.length, 1, 'Exactly one registered Cat-pilot is required');
    projectId = rows[0]!.id;
  } finally {
    registry.close();
  }
  return new AppState(file, projectId);
}
