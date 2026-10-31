import { mkdirSync, lstatSync, realpathSync, existsSync, openSync, closeSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface StoredCredential {
  connection: string;
  revision: number;
  endpoint: string;
  id: string;
  version: number;
  encrypted: Uint8Array;
}

/** A separate lifetime lock DB lets OS exit release ownership without losing committed keys. */
export class CredentialStore {
  private readonly lock: DatabaseSync;
  private readonly db: DatabaseSync;
  constructor(directory: string) {
    if (!isAbsolute(directory)) throw new Error('Credential directory must be absolute');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
      throw new Error('Credential directory must be a real directory');
    const root = realpathSync(directory);
    for (let parent = root; ; parent = dirname(parent)) {
      if (existsSync(join(parent, '.git')) || basename(parent).toLowerCase() === '.skaro')
        throw new Error('Credential storage cannot be inside a project');
      if (parent === dirname(parent)) break;
    }
    const path = join(root, 'model-credentials.sqlite');
    for (const file of [path, `${path}.lock`]) {
      try {
        const stat = lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
          throw new Error('Credential storage must be a private regular file');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        closeSync(openSync(file, 'wx', 0o600));
      }
    }
    this.lock = new DatabaseSync(`${path}.lock`);
    let database: DatabaseSync | undefined;
    try {
      this.lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');
      database = this.db = new DatabaseSync(path);
      this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS credentials (
          connection TEXT PRIMARY KEY, revision INTEGER NOT NULL, endpoint TEXT NOT NULL,
          id TEXT NOT NULL UNIQUE, version INTEGER NOT NULL, encrypted BLOB NOT NULL);`);
    } catch {
      database?.close();
      this.lock.close();
      throw new Error('Credential storage unavailable or already owned by another host');
    }
  }

  get(connection: string): StoredCredential | undefined {
    return this.db
      .prepare('SELECT * FROM credentials WHERE connection=?')
      .get(connection) as unknown as StoredCredential | undefined;
  }

  put(value: StoredCredential): void {
    this.db
      .prepare('INSERT OR REPLACE INTO credentials VALUES (?,?,?,?,?,?)')
      .run(
        value.connection,
        value.revision,
        value.endpoint,
        value.id,
        value.version,
        value.encrypted,
      );
  }

  delete(connection: string): void {
    this.db.prepare('DELETE FROM credentials WHERE connection=?').run(connection);
  }

  close(): void {
    try {
      this.db.close();
    } finally {
      this.lock.close();
    }
  }
}
