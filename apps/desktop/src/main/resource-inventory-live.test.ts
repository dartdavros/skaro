import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import {
  AppDb,
  ArtifactStore,
  COMPOSE_PROJECT,
  git,
  labelsOf,
  type DockerContainer,
} from '@skaro/core';
import { EnvironmentRegistry } from './task-environment-registry';
import { environmentResourceInventory } from './environment-resource-inventory';
import { worktreeResourceInventory } from './worktree-resource-inventory';
import { IntegrationStore } from './integration-store';
import { integrationResourceObservation } from './integration-resource-retention';

const data = process.env.SKARO_RESOURCE_VERIFY_DATA;
const execute = promisify(execFile);
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

async function docker(args: string[]): Promise<string> {
  const result = await execute('docker', args, {
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return result.stdout.trim();
}

async function dockerSnapshot(names: string[]) {
  const containers: DockerContainer[] = [];
  const objects: Record<string, Record<string, string[]>> = {};
  for (const name of names) {
    const filter = `label=${COMPOSE_PROJECT}=${name}`;
    const kinds = await Promise.all([
      docker(['ps', '-aq', '--filter', filter]),
      docker(['volume', 'ls', '-q', '--filter', filter]),
      docker(['network', 'ls', '-q', '--filter', filter]),
      docker(['images', '-a', '-q', '--filter', filter]),
    ]);
    const lists = kinds.map((output) => [...new Set(output.split(/\s+/).filter(Boolean))].sort());
    objects[name] = Object.fromEntries(
      ['containers', 'volumes', 'networks', 'images'].map((kind, index) => [kind, lists[index]!]),
    );
    for (const id of lists[0]!) {
      // Read actual inspect metadata without exposing container environment variables/secrets.
      const format =
        '{"Id":{{json .Id}},"Name":{{json .Name}},' +
        '"State":{"Running":{{json .State.Running}}},"Mounts":{{json .Mounts}},' +
        '"Config":{"Labels":{{json .Config.Labels}}}}';
      containers.push(
        JSON.parse(await docker(['inspect', '--format', format, id])) as DockerContainer,
      );
    }
  }
  containers.sort((a, b) => a.Id.localeCompare(b.Id));
  return { containers, objects };
}

async function artifactHashes(root: string): Promise<[string, string][]> {
  const paths = ['.skaro/config.yaml'];
  for (const directory of ['.skaro/tasks', '.skaro/milestones']) {
    try {
      for (const name of await readdir(join(root, directory)))
        if (name.endsWith('.md')) paths.push(`${directory}/${name}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return Promise.all(
    paths
      .sort()
      .map(async (path): Promise<[string, string]> => [
        path,
        digest(await readFile(join(root, path))),
      ]),
  );
}

function rowsHash(sql: DatabaseSync, query: string, projectId?: string): string {
  const hash = createHash('sha256');
  const statement = sql.prepare(query);
  const rows = projectId ? statement.iterate(projectId) : statement.iterate();
  for (const row of rows) hash.update(JSON.stringify(row)).update('\n');
  return hash.digest('hex');
}

async function sourceSnapshot(sql: DatabaseSync, db: AppDb, projectId: string, root: string) {
  return {
    schemaVersion: db.schemaVersion,
    schema: rowsHash(sql, 'SELECT name,type,sql FROM sqlite_master ORDER BY name,type'),
    settings: rowsHash(sql, 'SELECT key,value FROM settings ORDER BY key'),
    runs: rowsHash(sql, 'SELECT * FROM runs WHERE project_id=? ORDER BY id', projectId),
    resources: db.resources.list(projectId),
    collections: rowsHash(sql, 'SELECT * FROM collection_records ORDER BY collection,id'),
    collectionMigrations: rowsHash(sql, 'SELECT * FROM collection_migrations ORDER BY key'),
    artifacts: await artifactHashes(root),
    status: digest(
      (await git(root, ['--no-optional-locks', 'status', '--porcelain=v1', '-uall'])).stdout,
    ),
    worktrees: (await git(root, ['--no-optional-locks', 'worktree', 'list', '--porcelain', '-z']))
      .stdout,
  };
}

/** Opt-in inspection of registered Cat-pilot only; no fixtures, migration, services or cleanup. */
it.skipIf(!data)(
  'inventories actual Cat-pilot resources without changing sources or Docker',
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
      expect(db.shell.list().map((entry) => entry.id)).toEqual([project.id]);
      const context = {
        id: project.id,
        root: project.path,
        store: new ArtifactStore(project.path),
      };
      const registry = new EnvironmentRegistry(db);
      const artifacts = await context.store.load();
      const names = [
        ...new Set([
          ...[...registry.all(), ...registry.retired()]
            .filter((record) => record.projectId === project.id)
            .map((record) => record.name),
          ...(artifacts.config.environment?.source
            ? [artifacts.config.environment.source.project]
            : []),
          ...db.resources
            .list(project.id)
            .filter((record) => record.purpose === 'project-dev')
            .flatMap((record) => record.identity.composeProject ?? []),
        ]),
      ].sort();
      // A real daemon is required even when no managed Compose project currently exists.
      expect(await docker(['version', '--format', '{{.Server.Version}}'])).not.toBe('');
      const before = await sourceSnapshot(sql, db, project.id, project.path);
      const physical = await dockerSnapshot(names);
      const deps = {
        db,
        registry,
        dataDir: resolve(data!),
        projectScope: project.id,
        projects: {
          get(id: string) {
            expect(id).toBe(project.id);
            return context;
          },
        },
      };
      const inventory = async () => ({
        worktrees: await worktreeResourceInventory(db, resolve(data!), context),
        integrations: await Promise.all(
          new IntegrationStore(db, resolve(data!))
            .all(project.id)
            .map((op) => integrationResourceObservation(db, resolve(data!), context, op)),
        ),
        environments: await environmentResourceInventory(deps, physical.containers),
      });
      const first = await inventory();
      expect(await inventory()).toEqual(first);
      expect(
        [
          ...new Set(first.environments.map((item) => item.resource.identity.composeProject)),
        ].sort(),
      ).toEqual(names);
      const recordedPaths = db
        .listRuns(project.id)
        .flatMap((run) => (run.worktree ? [resolve(run.worktree)] : []));
      for (const path of new Set(recordedPaths))
        expect(first.worktrees.some((item) => item.registration.identity.path === path)).toBe(true);
      const gitPaths = before.worktrees
        .split('\0')
        .filter((line) => line.startsWith('worktree '))
        .map((line) => resolve(line.slice(9)));
      for (const item of first.worktrees) {
        expect(item.registration.projectId).toBe(project.id);
        const path = item.registration.identity.path!;
        let present = true;
        try {
          await lstat(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          present = false;
        }
        expect(item.present, path).toBe(present);
        if (!present) expect(item.reason).toBe('path-absent');
        if (item.registration.ownership === 'registered') {
          expect(gitPaths).toContain(resolve(path));
          expect((await git(path, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(item.head);
          expect(
            (await git(path, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim(),
          ).toBe(item.branch);
        }
      }
      for (const item of first.environments) {
        expect(item.resource.projectId).toBe(project.id);
        expect([...(item.resource.objectIds ?? [])].sort()).toEqual(
          physical.containers
            .filter(
              (container) =>
                labelsOf(container)[COMPOSE_PROJECT] === item.resource.identity.composeProject,
            )
            .map((container) => container.Id)
            .sort(),
        );
      }
      for (const item of first.integrations) {
        expect(item.registration.projectId).toBe(project.id);
        const path = item.registration.identity.path!;
        const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return undefined;
          throw error;
        });
        expect(item.present).toBe(!!stat);
        if (!stat) expect(item.reason).toBe('path-absent');
        if (item.registration.ownership === 'registered') {
          expect(gitPaths).toContain(resolve(path));
          expect((await git(path, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(
            item.registration.source?.commit,
          );
          expect(
            (await git(path, ['symbolic-ref', '--quiet', 'HEAD'], { allowFail: true })).code,
          ).toBe(1);
        }
      }
      expect(await dockerSnapshot(names)).toEqual(physical);
      expect(await sourceSnapshot(sql, db, project.id, project.path)).toEqual(before);
    } finally {
      db.close();
      sql.close();
    }
  },
  120_000,
);
