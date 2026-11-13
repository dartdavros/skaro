import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { DbSettings } from '../../../../packages/core/src/db/settings';
import { MIGRATIONS } from '../../../../packages/core/src/db/migrations';
import { EnvironmentRegistry } from './task-environment-registry';

it('strictly retains malformed registry JSON in real SQLite instead of replacing it with an empty registry', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(MIGRATIONS[0]!);
    const settings = new DbSettings(sqlite, Date.now);
    // A negative settings value, not a project fixture or substitute service.
    sqlite.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('environments', '{');
    let diagnostics = 0;
    const registry = new EnvironmentRegistry(settings, () => diagnostics++);
    expect(() => registry.all()).toThrow('registry is malformed');
    expect(() => registry.ensure({ projectId: 'project', taskId: 'task' }, 'project')).toThrow(
      'registry is malformed',
    );
    expect(diagnostics).toBe(2);
    expect(
      sqlite.prepare('SELECT value FROM settings WHERE key=?').get('environments')?.value,
    ).toBe('{');
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM projects').get()?.count).toBe(0);
  } finally {
    sqlite.close();
  }
});
