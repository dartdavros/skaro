import { realpath } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { AppDb, git, GitSnapshot } from '@skaro/core';
import { historyResource, pinHistoryExport } from './history-file-records';
import { newHistoryEntry } from './history-file-metadata';
import { pinWorktreeAccess } from './worktree-access';
import { cacheEviction } from './resource-cache-policy';
import { historyEvictionOperation } from './history-file-eviction';

it('persists generation-bound OS export and working-copy pins in actual SQLite without adding projects or runtime resources', async () => {
  const repo = await realpath(
    (await git(process.cwd(), ['rev-parse', '--show-toplevel'])).stdout.trim(),
  );
  const head = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const bytes = await new GitSnapshot(repo, head).read('package.json');
  const entry = newHistoryEntry(head, 'package.json', bytes);
  const db = AppDb.open(':memory:');
  try {
    const initial = historyResource(db, repo, repo, entry);
    const pinned = pinHistoryExport(db, initial);
    expect(db.listProjects()).toEqual([]);
    expect(db.resources.get(pinned.id)?.consumers).toEqual(pinned.consumers);
    expect(pinHistoryExport(db, pinned)).toEqual(pinned); // Idempotent handoff, no TTL.
    expect(pinned.consumers[0]).toMatchObject({ kind: 'preview', generation: initial.generation });
    expect(() => db.resources.update(pinned.id, pinned.revision, { generation: 2 })).toThrow(
      'Stale or duplicate resource consumer',
    );
    expect(db.resources.get(pinned.id)?.generation).toBe(initial.generation);
    pinWorktreeAccess(db, repo, repo);
    const worktree = db.resources.list(repo).find((record) => record.kind === 'worktree')!;
    expect(worktree.consumers[0]?.id).toMatch(/^explicit-access:/);
    expect(worktree.consumers[0]?.generation).toBe(worktree.generation);
    pinWorktreeAccess(db, repo, repo);
    expect(db.resources.get(worktree.id)?.consumers).toHaveLength(1);
    const legacy = historyResource(db, repo, repo, {
      ...newHistoryEntry(head, 'package.json', bytes),
      phase: 'legacy',
      commit: undefined,
      pending: undefined,
    });
    expect(legacy.ownership).toBe('legacy-unverified');
    expect(legacy.consumers[0]?.kind).toBe('unknown');
    // Global pressure and arbitrarily old use do not authorize deleting unknown OS users.
    const candidates = db.resources.list(repo).map((record) => ({
      id: record.id,
      bytes: bytes.length,
      usedAt: 0,
      consumers: record.consumers.length,
      ownership: 'registered' as const,
      preservation: 'reproducible' as const,
      immutable: true,
      secretsExcluded: true,
      privateScope: true,
    }));
    const decision = cacheEviction(
      candidates,
      { bytes: 0, entries: 0, idleMs: 0 },
      Number.MAX_SAFE_INTEGER,
    );
    expect(decision.remove).toEqual([]);
    expect(decision.fits).toBe(false);
    expect(decision.retained.every((outcome) => outcome.reason === 'active-consumer')).toBe(true);
  } finally {
    db.close();
  }
});

it('excludes new export pins during durable cleanup and resumes only the same exact fenced operation', async () => {
  const repo = await realpath(
    (await git(process.cwd(), ['rev-parse', '--show-toplevel'])).stdout.trim(),
  );
  const head = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  const entry = newHistoryEntry(
    head,
    'package.json',
    await new GitSnapshot(repo, head).read('package.json'),
  );
  const db = AppDb.open(':memory:');
  try {
    const record = historyResource(db, repo, repo, entry),
      operation = historyEvictionOperation(record);
    // SQLite state transitions only: no physical publication or cleanup is run by this test.
    await expect(
      db.resources.cleanup.run(record, operation, async () => {
        expect(() => pinHistoryExport(db, record)).toThrow(
          'Resource cleanup cannot admit new consumers',
        );
        db.resources.cleanup.effect(record.id);
        throw new Error('Interrupted cleanup checkpoint');
      }),
    ).rejects.toThrow('Interrupted cleanup checkpoint');
    expect(db.resources.cleanup.read(record.id)).toMatchObject({
      operationId: operation,
      state: 'retry',
    });
    expect(() => pinHistoryExport(db, record)).toThrow(
      'Resource cleanup excludes new consumers and mutations',
    );
    await expect(
      db.resources.cleanup.run(record, `${operation}:different`, async () => undefined),
    ).rejects.toThrow('another operation or generation');
    await expect(
      db.resources.cleanup.run(
        { ...record, source: { ...record.source, dataVersion: '0'.repeat(64) } },
        operation,
        async () => undefined,
      ),
    ).rejects.toThrow('ownership or consumers changed');
    await db.resources.cleanup.run(record, operation, async () => {
      expect(() => pinHistoryExport(db, record)).toThrow(
        'Resource cleanup cannot admit new consumers',
      );
      const current = db.resources.get(record.id)!;
      db.resources.update(current.id, current.revision, { state: 'released' });
    });
    expect(db.resources.cleanup.read(record.id)).toBeUndefined();
    expect(db.resources.get(record.id)?.state).toBe('released');
    expect(db.listProjects()).toEqual([]);
  } finally {
    db.close();
  }
});
