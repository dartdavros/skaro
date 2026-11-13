import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import type { ResourceRegistration } from '../resources/model.ts';
import { resourceId } from '../resources/validation.ts';
import { AppDb } from './appdb.ts';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations.ts';
import { RESOURCE_MIGRATION } from './resource-migration.ts';

it('persists an actual filesystem observation, rejects stale writes, and replays outcomes exactly', async () => {
  const path = await realpath(process.cwd());
  expect((await stat(path)).isDirectory()).toBe(true);
  const input: ResourceRegistration = {
    // An actual observed filesystem identity; no fabricated project is inserted into AppDb.
    projectId: path,
    kind: 'worktree',
    identity: { path },
    owner: { kind: 'unknown', id: path },
    purpose: 'unknown',
    ownership: 'legacy-unverified',
    preservation: 'unknown',
    generation: 1,
    consumers: [],
    state: 'retained',
  };
  const directory = await mkdtemp(join(tmpdir(), 'skaro-resource-ledger-'));
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith('skaro-resource-ledger-')
  )
    throw new Error('Unexpected verification directory');
  const file = join(directory, 'ledger.sqlite');
  const first = AppDb.open(file);
  const second = AppDb.open(file);
  let reopened: AppDb | undefined;
  let connectionsClosed = false;
  try {
    const initial = first.resources.register(input);
    expect(initial.id).toBe(resourceId(input));
    expect(second.resources.register(input)).toEqual(initial);
    expect(first.listProjects()).toEqual([]);
    expect(() => second.resources.register({ ...input, purpose: 'worktree' })).toThrow(
      'different registration',
    );
    const updated = second.resources.update(initial.id, initial.revision, { state: 'available' });
    expect(() =>
      first.resources.update(initial.id, initial.revision, { state: 'released' }),
    ).toThrow('revision changed');
    expect(first.resources.get(initial.id)).toEqual(updated);
    expect(() => first.resources.update(initial.id, updated.revision, { generation: 2 })).toThrow(
      'after release',
    );
    const operation = {
      operationId: randomUUID(),
      resourceId: initial.id,
      generation: 1,
      action: 'inspect' as const,
      state: 'retained' as const,
      reason: 'ownership_unverified',
    };
    const outcome = first.resources.recordOutcome(operation);
    expect(second.resources.recordOutcome(operation)).toEqual(outcome);
    expect(() =>
      second.resources.recordOutcome({ ...operation, reason: 'different_reason' }),
    ).toThrow('different outcome');
    const released = first.resources.update(initial.id, updated.revision, { state: 'released' });
    const next = second.resources.update(initial.id, released.revision, { generation: 2 });
    expect(() =>
      first.resources.recordOutcome({ ...operation, operationId: randomUUID() }),
    ).toThrow('obsolete generation');
    expect(first.resources.recordOutcome(operation)).toEqual(outcome);
    first.close();
    second.close();
    connectionsClosed = true;
    reopened = AppDb.readOnly(file);
    expect(reopened.resources.list(path)).toEqual([next]);
    expect(reopened.resources.outcomes(initial.id)).toEqual([outcome]);
    expect(reopened.resources.get(initial.id)?.lastOutcome).toEqual(outcome);
    expect(() =>
      reopened!.resources.update(initial.id, next.revision, { state: 'retained' }),
    ).toThrow();
  } finally {
    reopened?.close();
    if (!connectionsClosed) {
      first.close();
      second.close();
    }
    await rm(directory, { recursive: true, force: true });
  }
});

it('does not migrate an older empty database during read-only inventory', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    // Schema only, without seeded projects, task rows or resource data.
    for (const migration of MIGRATIONS.slice(0, MIGRATIONS.indexOf(RESOURCE_MIGRATION)))
      db.exec(migration);
    db.exec('PRAGMA query_only=ON');
    const { DbResources } = await import('./resources.ts');
    const ledger = new DbResources(db, Date.now);
    expect(ledger.list()).toEqual([]);
    expect(ledger.get('not-registered')).toBeUndefined();
    expect(ledger.outcomes('not-registered')).toEqual([]);
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name='resources'").get()).toBeUndefined();
  } finally {
    db.close();
  }
});
