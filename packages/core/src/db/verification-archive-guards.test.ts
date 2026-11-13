import { expect, it } from 'vitest';
import {
  archiveKey,
  archiveManifest,
  archiveBlob,
  archiveBlobSet,
  archiveDigest,
  archiveSqliteVersion,
  archiveCheckpoint,
  archivePageSize,
  ARCHIVE_BLOB_LIMIT,
  ARCHIVE_MANIFEST_LIMIT,
  ARCHIVE_TOTAL_LIMIT,
  ARCHIVE_NODE_LIMIT,
} from './verification-archive-guards.ts';

import {
  archiveWriteStep,
  archiveWriteTransaction,
  archiveTransactionState,
  type ArchiveWrite,
} from './verification-archive-write.ts';
import { VERIFICATION_ARCHIVE_SCHEMA } from './verification-archive-schema.ts';

const key = {
  projectId: '11111111-1111-4111-8111-111111111111',
  archiveId: '22222222-2222-4222-8222-222222222222',
  subjectIntent: '33333333-3333-4333-8333-333333333333',
};
const digest = (n: number) => n.toString(16).padStart(64, '0');

it('validates readonly SQLite page allocation dimensions without requiring write-version support', () => {
  for (const size of [512, 1024, 2048, 4096, 8192, 16384, 32768, 65536])
    expect(archivePageSize(size)).toBe(size);
  for (const bad of [0, -512, 256, 513, 65537, 131072, 1.5, NaN, Infinity, '4096', undefined])
    expect(() => archivePageSize(bad)).toThrow('page_size_invalid');
});
it('gates every separate schema and data statement plus BEGIN and COMMIT', () => {
  const trace: string[] = [];
  const write: ArchiveWrite = (effect) =>
    archiveWriteStep(() => {
      trace.push('gate');
    }, effect);
  archiveWriteTransaction(
    write,
    () => {
      trace.push('BEGIN');
    },
    (statement) => {
      for (const sql of VERIFICATION_ARCHIVE_SCHEMA)
        statement(() => {
          trace.push(sql);
        });
      statement(() => {
        trace.push('INSERT');
      });
    },
    () => {
      trace.push('COMMIT');
    },
    () => {
      trace.push('ROLLBACK');
    },
  );
  expect(trace).toEqual(
    ['BEGIN', ...VERIFICATION_ARCHIVE_SCHEMA, 'INSERT', 'COMMIT'].flatMap((sql) => ['gate', sql]),
  );
  expect(VERIFICATION_ARCHIVE_SCHEMA.filter((sql) => sql.startsWith('CREATE TABLE'))).toHaveLength(
    2,
  );
  const triggers = VERIFICATION_ARCHIVE_SCHEMA.filter((sql) => sql.startsWith('CREATE TRIGGER'));
  expect(triggers).toHaveLength(5);
  for (const sql of triggers) expect(sql).toContain('BEGIN SELECT RAISE(ABORT,');
  for (const sql of triggers) expect(sql).toMatch(/; END;$/);
});
it('refusal at any statement stops it and all later statements and rolls back without replacing the error', () => {
  const statements = ['BEGIN', 'CREATE', 'INSERT', 'UPDATE', 'COMMIT'];
  for (let denied = 0; denied < statements.length; denied++) {
    const original = new Error('gate refused');
    const done: string[] = [];
    let calls = 0;
    const write: ArchiveWrite = (effect) =>
      archiveWriteStep(() => {
        if (calls++ === denied) throw original;
      }, effect);
    expect(() =>
      archiveWriteTransaction(
        write,
        () => {
          done.push('BEGIN');
        },
        (statement) => {
          for (const sql of statements.slice(1, -1))
            statement(() => {
              done.push(sql);
            });
        },
        () => {
          done.push('COMMIT');
        },
        () => {
          done.push('ROLLBACK');
          throw new Error('rollback failure');
        },
      ),
    ).toThrow(original);
    expect(done).toEqual([...statements.slice(0, denied), 'ROLLBACK']);
    expect(calls).toBe(denied + 1);
  }
});
it('permits an existing owned transaction around a gate but rejects entry nesting or a changed boundary', () => {
  expect(() => archiveTransactionState(true, true)).not.toThrow();
  expect(() => archiveTransactionState(false, false)).not.toThrow();
  expect(() => archiveTransactionState(true, false)).toThrow('transaction_changed');
  expect(() => archiveTransactionState(false, true)).toThrow('transaction_changed');
});
it('does not execute a statement for an asynchronous host gate', () => {
  let effects = 0;
  expect(() =>
    archiveWriteStep(
      () => ({ then() {} }),
      () => ++effects,
    ),
  ).toThrow('async_host_gate');
  expect(effects).toBe(0);
});

it('permits only WAL-reset-patched releases including the two explicit backport branches', () => {
  for (const version of [
    '3.51.3',
    '3.51.4',
    '3.53.4',
    '3.50.7',
    '3.50.8',
    '3.44.6',
    '3.44.7',
    '4.0.0',
  ])
    expect(() => archiveSqliteVersion(version)).not.toThrow();
  for (const version of [
    '3.50.4',
    '3.51.2',
    '3.50.6',
    '3.44.5',
    '3.49.9',
    '3.45.99',
    '2.99.99',
    '3.53',
    '3.53.4-extra',
    '3.53.4\n',
    '',
  ])
    expect(() => archiveSqliteVersion(version)).toThrow('sqlite_unsupported');
});
it('rejects FULL checkpoints that are busy, partial, non-WAL, malformed or numerically unsafe', () => {
  expect(archiveCheckpoint({ busy: 0, log: 8, checkpointed: 8 })).toEqual({
    busy: 0,
    log: 8,
    checkpointed: 8,
  });
  expect(archiveCheckpoint({ busy: 0, log: 0, checkpointed: 0 })).toEqual({
    busy: 0,
    log: 0,
    checkpointed: 0,
  });
  for (const row of [
    undefined,
    null,
    {},
    { busy: 1, log: 8, checkpointed: 8 },
    { busy: 0, log: 8, checkpointed: 7 },
    { busy: 0, log: -1, checkpointed: -1 },
    { busy: 0, log: 0.5, checkpointed: 0.5 },
    { busy: 0, log: '8', checkpointed: '8' },
    { busy: 0, log: Number.MAX_SAFE_INTEGER + 1, checkpointed: Number.MAX_SAFE_INTEGER + 1 },
  ])
    expect(() => archiveCheckpoint(row)).toThrow('checkpoint_incomplete');
});
it('binds all three strict IDs to the current project scope without rewriting keys', () => {
  expect(archiveKey(key, key.projectId)).toEqual([key.projectId, key.archiveId, key.subjectIntent]);
  expect(() => archiveKey(key, key.archiveId)).toThrow('scope_invalid');
  for (const field of ['projectId', 'archiveId', 'subjectIntent'] as const)
    for (const bad of ['', '../foreign', `${key[field]}\n`, `${key[field].slice(0, -1)}A`])
      expect(() => archiveKey({ ...key, [field]: bad })).toThrow('scope_invalid');
});
it('hashes original UTF-8 manifest and blob bytes and rejects wrong digests', () => {
  expect(archiveDigest('abc')).toBe(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  const text = '{"reason":"сохранить"}';
  expect(archiveManifest(text)).toEqual({
    bytes: Buffer.byteLength(text),
    digest: archiveDigest(Buffer.from(text)),
  });
  for (const bad of ['', '\ud800']) expect(() => archiveManifest(bad)).toThrow('manifest_invalid');
  expect(() => archiveManifest('x'.repeat(ARCHIVE_MANIFEST_LIMIT + 1))).toThrow('manifest_limit');
  const data = Buffer.from([0, 255, 1]);
  expect(() => archiveBlob(data, archiveDigest(data))).not.toThrow();
  expect(() => archiveBlob(data, 'a'.repeat(64))).toThrow('blob_digest_changed');
  expect(() => archiveBlob(data, '../foreign')).toThrow('digest_invalid');
  expect(() => archiveBlob(Buffer.alloc(0), archiveDigest(Buffer.alloc(0)))).not.toThrow();
});
it('requires the exact unique blob set and bounds per-blob, total archive and node dimensions', () => {
  const first = { digest: digest(1), bytes: 1 },
    second = { digest: digest(2), bytes: 2 };
  expect(archiveBlobSet([second, first])).toEqual([first, second]);
  expect(() => archiveBlobSet([first, first])).toThrow('blob_set_invalid');
  for (const bytes of [-1, 0.5, NaN, Infinity, ARCHIVE_BLOB_LIMIT + 1])
    expect(() => archiveBlobSet([{ ...first, bytes }])).toThrow('blob_set_invalid');
  const full = Array.from({ length: ARCHIVE_TOTAL_LIMIT / ARCHIVE_BLOB_LIMIT }, (_, n) => ({
    digest: digest(n),
    bytes: ARCHIVE_BLOB_LIMIT,
  }));
  expect(archiveBlobSet(full)).toHaveLength(8);
  expect(() => archiveBlobSet(full, 1)).toThrow('total_limit');
  expect(() => archiveBlobSet([...full, { digest: digest(9), bytes: 1 }])).toThrow('total_limit');
  const nodes = Array.from({ length: ARCHIVE_NODE_LIMIT }, (_, n) => ({
    digest: digest(n),
    bytes: 0,
  }));
  expect(archiveBlobSet(nodes)).toHaveLength(ARCHIVE_NODE_LIMIT);
  expect(() =>
    archiveBlobSet([...nodes, { digest: digest(ARCHIVE_NODE_LIMIT), bytes: 0 }]),
  ).toThrow('node_limit');
  expect(() => archiveBlobSet([], ARCHIVE_MANIFEST_LIMIT + 1)).toThrow('manifest_limit');
});
