// Snapshot actual Skaro data for an isolated check of the real Electron app and backend.
// No tasks, runs, API responses or project artifacts are fabricated.
import { DatabaseSync, backup } from 'node:sqlite';
import { cpSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const source = resolve(process.argv[2] ?? join(process.env.APPDATA, 'Skaro'));
const destination = mkdtempSync(join(tmpdir(), 'skaro-sidebar-live-'));
const db = new DatabaseSync(join(source, 'skaro.db'), { readOnly: true });
try {
  await backup(db, join(destination, 'skaro.db'));
} finally {
  db.close();
}
for (const directory of ['runs', 'attachments']) {
  const path = join(source, directory);
  if (existsSync(path)) cpSync(path, join(destination, directory), { recursive: true });
}
process.stdout.write(destination + '\n');
