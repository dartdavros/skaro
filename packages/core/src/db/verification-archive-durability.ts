import type { DatabaseSync } from 'node:sqlite';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, normalize, parse, relative, resolve, join } from 'node:path';
import {
  archiveWriteStep,
  archiveWriteTransaction,
  archiveTransactionState,
  type ArchiveWrite,
} from './verification-archive-write.ts';
import {
  archiveCheckpoint,
  archiveSqliteVersion,
  type VerificationArchiveDatabaseIdentity,
  type VerificationArchiveHostGate,
  type VerificationArchiveReceipt,
} from './verification-archive-guards.ts';

const plain = (path: string) => path.replace(/^\\\\\?\\/, '');
const comparable = (path: string) =>
  process.platform === 'win32' ? normalize(plain(path)).toLowerCase() : normalize(path);
/** Lazy pin: construction performs no filesystem access, SQL, migration, or connection creation. */
export class VerificationArchiveDurability {
  private pin?: VerificationArchiveDatabaseIdentity;
  private readonly db: DatabaseSync;
  private readonly filePath: string;
  private readonly readOnly: boolean;
  constructor(db: DatabaseSync, filePath: string, readOnly: boolean) {
    this.db = db;
    this.filePath = filePath;
    this.readOnly = readOnly;
  }
  get databaseIdentity(): VerificationArchiveDatabaseIdentity {
    return { ...this.checkPin() };
  }
  checkPin(): VerificationArchiveDatabaseIdentity {
    if (!isAbsolute(this.filePath) || this.filePath === ':memory:')
      throw new Error('verification_archive_existing_database_required');
    const path = resolve(this.filePath),
      volume = parse(path).root;
    let current = volume;
    for (const part of relative(volume, path).split(/[\\/]/).filter(Boolean)) {
      current = join(current, part);
      if (
        lstatSync(current, { bigint: true }).isSymbolicLink() ||
        comparable(realpathSync(current)) !== comparable(current)
      )
        throw new Error('verification_archive_database_redirected');
    }
    const main = this.db
      .prepare('PRAGMA database_list')
      .all()
      .find((row) => row.name === 'main');
    if (!main || typeof main.file !== 'string' || comparable(main.file) !== comparable(path))
      throw new Error('verification_archive_connection_mismatch');
    const info = lstatSync(path, { bigint: true });
    if (
      !info.isFile() ||
      info.nlink !== 1n ||
      info.dev <= 0n ||
      info.ino <= 0n ||
      info.birthtimeNs <= 0n ||
      info.dev >= 1n << 64n ||
      info.ino >= 1n << 64n ||
      info.birthtimeNs >= 1n << 63n
    )
      throw new Error('verification_archive_database_identity_invalid');
    const identity: VerificationArchiveDatabaseIdentity = {
      version: 'native-bigint-v1',
      dev: info.dev.toString(),
      ino: info.ino.toString(),
      birthtimeNs: info.birthtimeNs.toString(),
    };
    if (
      this.pin &&
      (this.pin.dev !== identity.dev ||
        this.pin.ino !== identity.ino ||
        this.pin.birthtimeNs !== identity.birthtimeNs)
    )
      throw new Error('verification_archive_database_identity_changed');
    this.pin ??= identity;
    return identity;
  }
  private idle(): void {
    if (this.db.isTransaction) throw new Error('verification_archive_transaction_active');
  }
  private transaction(expected: boolean): void {
    archiveTransactionState(this.db.isTransaction, expected);
  }
  private step<T>(gate: VerificationArchiveHostGate, action: () => T, inTransaction = false): T {
    this.transaction(inTransaction);
    this.checkPin();
    return archiveWriteStep(gate, () => {
      // CleanupFenceStore's host gate may use SAVEPOINT on our connection; it must leave our transaction intact.
      this.transaction(inTransaction);
      this.checkPin();
      const result = action();
      this.checkPin();
      return result;
    });
  }
  private mode(): void {
    const journal = this.db.prepare('PRAGMA journal_mode').get()?.journal_mode;
    const synchronous = this.db.prepare('PRAGMA synchronous').get()?.synchronous;
    if (journal !== 'wal' || synchronous !== 2)
      throw new Error('verification_archive_durability_mode_invalid');
  }
  prepare(gate: VerificationArchiveHostGate): string {
    if (this.readOnly) throw new Error('verification_archive_readonly');
    this.idle();
    this.checkPin();
    const version = String(this.db.prepare('SELECT sqlite_version() AS version').get()?.version);
    archiveSqliteVersion(version);
    this.step(gate, () => {
      this.db.prepare('PRAGMA journal_mode=WAL').get();
    });
    this.step(gate, () => {
      this.db.exec('PRAGMA synchronous=FULL');
    });
    this.mode();
    return version;
  }
  atomic(gate: VerificationArchiveHostGate, action: (write: ArchiveWrite) => void): void {
    this.prepare(gate);
    let opened = false;
    const write: ArchiveWrite = (effect) => this.step(gate, effect, opened);
    archiveWriteTransaction(
      write,
      () => {
        this.db.exec('BEGIN IMMEDIATE');
        opened = true;
      },
      action,
      () => {
        this.mode();
        this.db.exec('COMMIT');
        opened = false;
      },
      () => {
        if (this.db.isTransaction) this.db.exec('ROLLBACK');
      },
    );
    this.idle();
  }
  barrier(gate: VerificationArchiveHostGate, verifySealed: () => void): VerificationArchiveReceipt {
    this.idle();
    verifySealed();
    const sqliteVersion = this.prepare(gate);
    verifySealed();
    let checkpoint: VerificationArchiveReceipt['checkpoint'] | undefined;
    this.step(gate, () => {
      // The host gate may commit its own ledger write. Reverify AFTER it and before checkpointing.
      verifySealed();
      this.mode();
      checkpoint = archiveCheckpoint(this.db.prepare('PRAGMA wal_checkpoint(FULL)').get());
      this.mode();
    });
    verifySealed();
    return { databaseIdentity: this.databaseIdentity, sqliteVersion, checkpoint: checkpoint! };
  }
}
