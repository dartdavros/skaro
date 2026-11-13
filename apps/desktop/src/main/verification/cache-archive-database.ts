import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { AppDb } from '@skaro/core';
import { canonicalDirectory } from '../managed-verification-archive-paths';
import { encodeNativeIdentity, type ExactNativeIdentity } from '../managed-native-identity';
import { assertDatabaseIdentity } from '../managed-verification-archive-sqlite';

/** Pin before either SQLite connection is opened. Missing/redirected files never become new DBs. */
export async function pinArchiveDatabase(data: string): Promise<ExactNativeIdentity> {
  await canonicalDirectory(data);
  const info = lstatSync(join(data, 'skaro.db'), { bigint: true });
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n)
    throw new Error('cache_archive_existing_database_required');
  return encodeNativeIdentity(info);
}
export function requireArchiveDatabasePin(data: string, expected: ExactNativeIdentity): void {
  const info = lstatSync(join(data, 'skaro.db'), { bigint: true });
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n)
    throw new Error('cache_archive_database_changed');
  assertDatabaseIdentity(encodeNativeIdentity(info), expected);
}
export function openPinnedArchiveDatabase(
  data: string,
  pin: ExactNativeIdentity,
  readOnly: boolean,
): AppDb {
  requireArchiveDatabasePin(data, pin);
  const path = join(data, 'skaro.db');
  const db = readOnly ? AppDb.readOnly(path) : AppDb.open(path);
  try {
    requireArchiveDatabasePin(data, pin);
    assertDatabaseIdentity(db.verificationArchives.databaseIdentity, pin);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
