import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { AppDb, git } from '@skaro/core';
import { savedOwnerCommand } from './owner-command-evidence';

const data = process.env.SKARO_COORDINATOR_VERIFY_DATA;
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

async function fileDigest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function rowsDigest(sql: DatabaseSync, query: string, ...args: string[]): string {
  const hash = createHash('sha256');
  for (const row of sql.prepare(query).iterate(...args))
    hash.update(JSON.stringify(row)).update('\n');
  return hash.digest('hex');
}

async function documents(root: string): Promise<[string, string][]> {
  const hashes: [string, string][] = [];
  const pending = ['.skaro'];
  while (pending.length) {
    const directory = pending.pop()!;
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) pending.push(path);
      else if (entry.isFile() && /\.(md|yaml|yml|json)$/.test(entry.name))
        hashes.push([path, digest(await readFile(join(root, path)))]);
    }
  }
  return hashes.sort(([a], [b]) => a.localeCompare(b));
}

async function snapshot(sql: DatabaseSync, db: AppDb, projectId: string, root: string) {
  const tableNames = sql
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((row) => String(row.name));
  const coordinatorTables = [
    'project_coordinators',
    'coordination_events',
    'coordination_intents',
    'coordination_operations',
    'coordination_entities',
  ];
  const logs: [string, string][] = [];
  for (const run of db.listRuns(projectId, undefined, { includeRetired: true })) {
    try {
      logs.push([run.id, await fileDigest(join(resolve(data!), run.logPath))]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      logs.push([run.id, 'absent']);
    }
  }
  return {
    schemaVersion: db.schemaVersion,
    schema: rowsDigest(sql, 'SELECT name,type,sql FROM sqlite_master ORDER BY name,type'),
    project: db.getProject(projectId),
    commands: rowsDigest(
      sql,
      'SELECT * FROM owner_commands WHERE owner LIKE ? ORDER BY id',
      `${projectId}:%`,
    ),
    runs: rowsDigest(sql, 'SELECT * FROM runs WHERE project_id=? ORDER BY id', projectId),
    chats: rowsDigest(sql, 'SELECT * FROM chats WHERE project_id=? ORDER BY id', projectId),
    settings: rowsDigest(
      sql,
      'SELECT key,value FROM settings WHERE instr(key,?)>0 ORDER BY key',
      projectId,
    ),
    collections: rowsDigest(
      sql,
      'SELECT * FROM collection_records WHERE instr(collection,?)>0 ORDER BY collection,id',
      projectId,
    ),
    migrations: rowsDigest(
      sql,
      'SELECT key FROM collection_migrations WHERE instr(key,?)>0 ORDER BY key',
      projectId,
    ),
    coordination: coordinatorTables.map((table) => [
      table,
      tableNames.includes(table)
        ? rowsDigest(sql, `SELECT * FROM ${table} WHERE project_id=? ORDER BY rowid`, projectId)
        : 'absent',
    ]),
    logs: logs.sort(([a], [b]) => a.localeCompare(b)),
    documents: await documents(root),
    gitStatus: digest(
      (await git(root, ['--no-optional-locks', 'status', '--porcelain=v1', '-uall'])).stdout,
    ),
  };
}

/** Real saved receipt evidence, never a dispatch/recovery runner or a synthetic project. */
it.skipIf(!data)(
  'reads actual Cat-pilot delivery evidence twice without migrating or changing the project',
  async () => {
    const file = join(resolve(data!), 'skaro.db');
    const sql = new DatabaseSync(file, { readOnly: true });
    const db = AppDb.readOnly(file);
    try {
      const projects = sql
        .prepare('SELECT id,path FROM projects WHERE name=? COLLATE NOCASE')
        .all('Cat-pilot') as { id: string; path: string }[];
      expect(projects).toHaveLength(1);
      const project = projects[0]!;
      db.shell.scopeTo(project.id);
      expect(db.shell.list().map((item) => item.id)).toEqual([project.id]);
      const commands = sql
        .prepare(
          "SELECT id FROM owner_commands WHERE owner LIKE ? AND state='delivered' ORDER BY updated_at,id",
        )
        .all(`${project.id}:%`)
        .map((row) => db.commands.get(String(row.id))!);
      // A vacuous pass is not evidence of saved native delivery.
      expect(commands.length).toBeGreaterThan(0);
      expect(commands.every((command) => command.args[0] === project.id)).toBe(true);
      const before = await snapshot(sql, db, project.id, project.path);
      const observe = async () => {
        const evidence: [string, boolean][] = [];
        for (const command of commands)
          evidence.push([command.id, await savedOwnerCommand(db, resolve(data!), command)]);
        return {
          coordinator: db.coordination.get(project.id),
          pending: db.coordination.pending(project.id),
          decisions: db.coordination.decisions.list(project.id),
          blockers: db.coordination.blockers.list(project.id),
          operations: commands.map((command) =>
            db.coordination.getOperation(project.id, `owner-command:${command.id}`),
          ),
          evidence,
        };
      };
      const first = await observe();
      expect(first.evidence.every(([, proven]) => proven)).toBe(true);
      expect(await observe()).toEqual(first);
      expect(await snapshot(sql, db, project.id, project.path)).toEqual(before);
    } finally {
      db.close();
      sql.close();
    }
  },
  120_000,
);
