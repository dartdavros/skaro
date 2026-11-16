import { mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { AppDb } from './appdb.ts';

it('uses savepoints for nested acceptance, retaining outer writes after inner failure and rolling back all writes after outer failure', () => {
  const db = AppDb.open(':memory:');
  try {
    db.settings.atomic(() => {
      db.setSetting('outer', 'committed');
      expect(() =>
        db.settings.atomic(() => {
          db.setSetting('inner', 'discarded');
          throw new Error('Inner acceptance rejected');
        }),
      ).toThrow('Inner acceptance rejected');
      expect(db.getSetting('outer', null)).toBe('committed');
      expect(db.getSetting('inner', null)).toBeNull();
    });
    expect(() =>
      db.settings.atomic(() => {
        db.setSetting('outer', 'discarded');
        db.settings.atomic(() => db.setSetting('inner', 'also discarded'));
        throw new Error('Outer incident commit rejected');
      }),
    ).toThrow('Outer incident commit rejected');
    expect(db.getSetting('outer', null)).toBe('committed');
    expect(db.getSetting('inner', null)).toBeNull();
  } finally {
    db.close();
  }
});

it('claims and replaces an actual persisted setting atomically across independent SQLite connections', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'skaro-setting-cas-'));
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith('skaro-setting-cas-')
  )
    throw new Error('Unexpected verification directory');
  const file = join(directory, 'settings.sqlite');
  const first = AppDb.open(file);
  const second = AppDb.open(file);
  try {
    const key = 'verification.compare-and-set';
    const initial = { generation: 1, state: 'prepared' };
    expect(first.settings.compareAndSet(key, undefined, initial)).toBe(true);
    expect(second.settings.compareAndSet(key, undefined, { generation: 2 })).toBe(false);
    expect(second.getSetting(key, null)).toEqual(initial);
    const active = { ...initial, state: 'active' };
    expect(second.settings.compareAndSet(key, initial, active)).toBe(true);
    expect(first.settings.compareAndSet(key, initial, { ...initial, state: 'revoked' })).toBe(
      false,
    );
    expect(first.getSetting(key, null)).toEqual(active);
    expect(() => first.settings.compareAndSet(key, active, undefined)).toThrow('JSON value');
    // Ordinary settings remain compatible; stale compare-and-set cannot overwrite them.
    first.setSetting(key, null);
    expect(second.settings.compareAndSet(key, active, initial)).toBe(false);
    expect(second.settings.compareAndSet(key, null, initial)).toBe(true);
  } finally {
    second.close();
    first.close();
    await rm(directory, { recursive: true, force: true });
  }
});
