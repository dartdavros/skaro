import type { DatabaseSync } from 'node:sqlite';
import {
  archiveKey,
  archiveManifest,
  archiveBlob,
  archiveBlobSet,
  archivePageSize,
  assertArchiveDigest,
  type VerificationArchiveKey,
  type VerificationArchiveBlob,
  type VerificationArchiveHeader,
  type VerificationArchiveHostGate,
} from './verification-archive-guards.ts';
import { VerificationArchiveDurability } from './verification-archive-durability.ts';
import { VERIFICATION_ARCHIVE_SCHEMA } from './verification-archive-schema.ts';
export type * from './verification-archive-guards.ts';

const WHERE = 'project_id=? AND archive_id=? AND subject_intent=?';
/** Append-only evidence on the EXISTING application connection; receipts never authorize deletion. */
export class DbVerificationArchives {
  private readonly durability: VerificationArchiveDurability;
  private readonly db: DatabaseSync;
  private readonly projectScope: () => string | undefined;
  constructor(
    db: DatabaseSync,
    filePath: string,
    readOnly: boolean,
    projectScope: () => string | undefined,
  ) {
    this.db = db;
    this.projectScope = projectScope;
    this.durability = new VerificationArchiveDurability(db, filePath, readOnly);
  }
  get databaseIdentity() {
    return this.durability.databaseIdentity;
  }
  /** Read-only allocation fact; valid even on SQLite versions that may not write archives. */
  get pageSize(): number {
    return this.read(() => archivePageSize(this.db.prepare('PRAGMA page_size').get()?.page_size));
  }
  private key(key: VerificationArchiveKey) {
    return archiveKey(key, this.projectScope());
  }
  private gate(
    key: VerificationArchiveKey,
    hostGate: VerificationArchiveHostGate,
  ): VerificationArchiveHostGate {
    if (typeof hostGate !== 'function') throw new Error('verification_archive_host_gate_required');
    return () => {
      this.key(key);
      const result: unknown = hostGate();
      if (result && typeof (result as { then?: unknown }).then === 'function')
        throw new Error('verification_archive_async_host_gate');
      this.key(key);
    };
  }
  private read<T>(action: () => T): T {
    this.durability.checkPin();
    const result = action();
    this.durability.checkPin();
    return result;
  }
  private hasTables(): boolean {
    return !!this.db
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='verification_archive_headers'",
      )
      .get();
  }
  header(key: VerificationArchiveKey): VerificationArchiveHeader | undefined {
    const params = this.key(key);
    return this.read(() => {
      if (!this.hasTables()) return undefined;
      const row = this.db
        .prepare(
          `SELECT manifest,manifest_digest,manifest_bytes,sealed FROM verification_archive_headers WHERE ${WHERE}`,
        )
        .get(...params);
      if (!row) return undefined;
      if (typeof row.manifest !== 'string')
        throw new Error('verification_archive_manifest_invalid');
      const manifest = archiveManifest(row.manifest);
      if (
        manifest.digest !== row.manifest_digest ||
        manifest.bytes !== row.manifest_bytes ||
        ![0, 1].includes(row.sealed as number)
      )
        throw new Error('verification_archive_header_changed');
      return { manifest: row.manifest, manifestDigest: manifest.digest, sealed: row.sealed === 1 };
    });
  }
  blobs(key: VerificationArchiveKey): VerificationArchiveBlob[] {
    const params = this.key(key);
    return this.read(() => {
      if (!this.hasTables()) return [];
      const rows = this.db
        .prepare(
          `SELECT digest,bytes FROM verification_archive_blobs WHERE ${WHERE} ORDER BY digest LIMIT 20001`,
        )
        .all(...params);
      return archiveBlobSet(
        rows.map((row) => ({ digest: row.digest as string, bytes: row.bytes as number })),
      );
    });
  }
  readBlob(key: VerificationArchiveKey, digest: string): Buffer {
    const params = this.key(key);
    assertArchiveDigest(digest);
    return this.read(() => {
      if (!this.hasTables()) throw new Error('verification_archive_blob_missing');
      const row = this.db
        .prepare(
          `SELECT payload,bytes FROM verification_archive_blobs WHERE ${WHERE} AND digest=? AND bytes BETWEEN 0 AND 33554432 AND length(payload)=bytes`,
        )
        .get(...params, digest);
      if (!row || !(row.payload instanceof Uint8Array))
        throw new Error('verification_archive_blob_missing');
      const data = Buffer.from(row.payload);
      archiveBlob(data, digest);
      if (data.length !== row.bytes) throw new Error('verification_archive_blob_size_changed');
      return data;
    });
  }
  create(
    key: VerificationArchiveKey,
    manifestText: string,
    hostGate: VerificationArchiveHostGate,
  ): void {
    key = { ...key };
    const params = this.key(key),
      manifest = archiveManifest(manifestText);
    this.durability.atomic(this.gate(key, hostGate), (write) => {
      this.key(key);
      for (const statement of VERIFICATION_ARCHIVE_SCHEMA) write(() => this.db.exec(statement));
      write(() =>
        this.db
          .prepare(
            `INSERT INTO verification_archive_headers
        (project_id,archive_id,subject_intent,manifest,manifest_digest,manifest_bytes,sealed) VALUES (?,?,?,?,?,?,0)`,
          )
          .run(...params, manifestText, manifest.digest, manifest.bytes),
      );
    });
    const created = this.header(key);
    if (!created || created.manifest !== manifestText || created.sealed)
      throw new Error('verification_archive_create_readback_failed');
  }
  putBlob(
    key: VerificationArchiveKey,
    digest: string,
    data: Buffer,
    hostGate: VerificationArchiveHostGate,
  ): void {
    key = { ...key };
    const params = this.key(key);
    archiveBlob(data, digest);
    data = Buffer.from(data);
    this.durability.atomic(this.gate(key, hostGate), (write) => {
      const header = this.header(key);
      if (!header || header.sealed) throw new Error('verification_archive_sealed_or_missing');
      archiveBlobSet(
        [...this.blobs(key), { digest, bytes: data.length }],
        Buffer.byteLength(header.manifest),
      );
      write(() =>
        this.db
          .prepare(
            `INSERT INTO verification_archive_blobs
        (project_id,archive_id,subject_intent,digest,bytes,payload) VALUES (?,?,?,?,?,?)`,
          )
          .run(...params, digest, data.length, data),
      );
    });
    if (!this.readBlob(key, digest).equals(data))
      throw new Error('verification_archive_blob_readback_failed');
  }
  private verifyContents(
    key: VerificationArchiveKey,
    expected?: readonly VerificationArchiveBlob[],
  ): void {
    const header = this.header(key);
    if (!header) throw new Error('verification_archive_missing');
    const actual = archiveBlobSet(this.blobs(key), Buffer.byteLength(header.manifest));
    if (
      expected &&
      JSON.stringify(actual) !==
        JSON.stringify(archiveBlobSet(expected, Buffer.byteLength(header.manifest)))
    )
      throw new Error('verification_archive_exact_blob_set_changed');
    for (const blob of actual)
      if (this.readBlob(key, blob.digest).length !== blob.bytes)
        throw new Error('verification_archive_blob_size_changed');
  }
  seal(
    key: VerificationArchiveKey,
    expectedBlobs: readonly VerificationArchiveBlob[],
    hostGate: VerificationArchiveHostGate,
  ): void {
    key = { ...key };
    const params = this.key(key),
      expected = archiveBlobSet(expectedBlobs);
    this.durability.atomic(this.gate(key, hostGate), (write) => {
      const header = this.header(key);
      if (!header || header.sealed) throw new Error('verification_archive_sealed_or_missing');
      this.verifyContents(key, expected);
      const result = write(() =>
        this.db
          .prepare(`UPDATE verification_archive_headers SET sealed=1 WHERE ${WHERE} AND sealed=0`)
          .run(...params),
      );
      if (result.changes !== 1) throw new Error('verification_archive_seal_failed');
    });
    if (!this.header(key)?.sealed) throw new Error('verification_archive_seal_readback_failed');
  }
  durabilityBarrier(key: VerificationArchiveKey, hostGate: VerificationArchiveHostGate) {
    key = { ...key };
    this.key(key);
    return this.durability.barrier(this.gate(key, hostGate), () => {
      if (!this.header(key)?.sealed) throw new Error('verification_archive_not_sealed');
      this.verifyContents(key);
    });
  }
}
