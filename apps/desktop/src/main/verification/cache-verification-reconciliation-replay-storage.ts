import type { AppDb } from '@skaro/core';
import { DatabaseSync } from 'node:sqlite';
import { dirname, isAbsolute, resolve } from 'node:path';
import { CACHE_VERIFICATION_OWNER_SCOPE } from './cache-verification-scope';
import {
  reconciliationJournalKey,
  RECONCILIATION_JOURNAL_BYTE_LIMIT,
  replayFail as fail,
} from './cache-verification-reconciliation-replay-types';

/** Read transaction only; no migrations, writer lock, settings mutation or lazy cache initialization. */
export function withReplayReader<T>(db: AppDb, action: (reader: DatabaseSync) => T): T {
  if (
    !isAbsolute(db.filePath) ||
    resolve(dirname(db.filePath), 'skaro.db') !== db.filePath ||
    db.shell.projectScope !== CACHE_VERIFICATION_OWNER_SCOPE.projectId
  )
    fail('database_scope');
  const reader = new DatabaseSync(db.filePath, { readOnly: true });
  try {
    reader.exec('PRAGMA query_only=ON; BEGIN');
    return action(reader);
  } finally {
    reader.close();
  }
}
export function readReplayJournalValue(db: AppDb, failedIntent?: string): unknown {
  return withReplayReader(db, (reader) => {
    // Bound BEFORE bringing text into JS/JSON.parse, including corrupt/hostile settings.
    const row = reader
      .prepare(
        `SELECT length(CAST(value AS BLOB)) AS bytes,
      CASE WHEN length(CAST(value AS BLOB)) <= ? THEN value ELSE NULL END AS value
      FROM settings WHERE key=?`,
      )
      .get(RECONCILIATION_JOURNAL_BYTE_LIMIT, reconciliationJournalKey(failedIntent));
    if (!row) return undefined;
    if (
      typeof row.bytes !== 'number' ||
      row.bytes > RECONCILIATION_JOURNAL_BYTE_LIMIT ||
      typeof row.value !== 'string'
    )
      fail('journal_size');
    return JSON.parse(String(row.value));
  });
}
