import { mkdtemp, rm } from 'node:fs/promises';
import { join, basename, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { AppState } from './state';
import { Projects } from './projects';
import { EnvironmentProjectScope } from './task-environment-scope';
import { projectRecords } from './project-records';
import { ProjectIndex } from './background/project-index';
import { PayloadStore } from './background/payload-store';

const directories: string[] = [];
const handles: { close(): void }[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

it('scopes real SQLite registry and stale runtime cleanup before bootstrap without restoring foreign tabs', async () => {
  // Pure DB boundary metadata: no project checkout, API/backend, fake history or process is created.
  const directory = await mkdtemp(join(tmpdir(), 'skaro-project-scope-'));
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith('skaro-project-scope-')
  )
    throw new Error('Unexpected verification directory');
  directories.push(directory);
  const file = join(directory, 'scope.sqlite');
  const db = AppDb.open(file);
  handles.push(db);
  const target = db.addProject({ name: 'Cat-pilot', path: join(directory, 'target-not-created') });
  const outside = db.addProject({
    name: 'Outside scope',
    path: join(directory, 'outside-not-created'),
  });
  db.setOpenTabs([outside.id], outside.id);
  const workspace = {
    view: 'project',
    sections: { [outside.id]: 'tasks' },
    openTasks: { [outside.id]: 'T-001' },
    openChats: {},
  };
  db.setSetting('ui.workspace', workspace);
  db.setTaskRuntime(outside.id, 'T-001', 'running');
  db.setTaskRuntime(target.id, 'T-001', 'running');
  const scoped = new AppState(file, target.id);
  handles.push(scoped);
  expect(scoped.db.shell.list().map((project) => project.id)).toEqual([target.id]);
  expect(scoped.db.shell.initial().map((project) => project.id)).toEqual([target.id]);
  expect(scoped.db.shell.get(outside.id)).toBeUndefined();
  expect(() => scoped.db.shell.scopeTo(outside.id)).toThrow('cannot change');
  expect(scoped.db.getTaskRuntime(target.id).size).toBe(0);
  expect(db.getTaskRuntime(outside.id).get('T-001')?.state).toBe('running');
  const visited: string[] = [];
  for await (const project of projectRecords(scoped.db)) visited.push(project.id);
  expect(visited).toEqual([target.id]);
  const bootstrap = scoped.bootstrap();
  expect(bootstrap.tabs).toEqual({ projects: [target.id], active: target.id });
  expect(bootstrap.workspace?.view).toBe('settings');
  expect(bootstrap.sessions).toBeUndefined();
  expect(bootstrap.projects.map((project) => project.id)).toEqual([target.id]);
  scoped.setSetting('ui.workspace', { view: 'settings' });
  scoped.setTabs({ projects: [target.id], active: target.id });
  expect(db.getSetting('ui.workspace', null)).toEqual(workspace);
  expect(db.shell.tabs()).toEqual([{ projectId: outside.id, active: true }]);
  const projects = new Projects(scoped.db, () => undefined);
  expect(() => projects.get(outside.id)).toThrow('unknown project');
  projects.close();
});

it('filters environment ownership before any cleanup callback and rejects foreign task requests', () => {
  const scope = new EnvironmentProjectScope('selected');
  const selected = { projectId: 'selected', taskId: 'T-001' };
  const outside = { projectId: 'outside', taskId: 'T-002' };
  expect(scope.records([selected, outside])).toEqual([selected]);
  expect(() => scope.require(outside)).toThrow('outside verification');
  expect(() => scope.require(selected)).not.toThrow();
  expect(scope.containers([], 'unused', new Map())).toEqual([]);
  expect(new EnvironmentProjectScope().records([selected, outside])).toEqual([selected, outside]);
});

it('indexes only scoped registry metadata in its separate cache without opening project paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'skaro-project-scope-'));
  directories.push(directory);
  const db = AppDb.open(join(directory, 'skaro.db'));
  handles.push(db);
  const target = db.addProject({ name: 'Cat-pilot', path: join(directory, 'not-created') });
  db.addProject({ name: 'Outside scope', path: join(directory, 'also-not-created') });
  const global = new PayloadStore(directory, 'registry.db');
  const scoped = new PayloadStore(directory, `registry-${target.id}.db`);
  handles.push(global.db, scoped.db);
  const all = new ProjectIndex(global).query({ query: '', sort: 'name' });
  const index = new ProjectIndex(scoped, target.id);
  const selected = index.query({ query: '', sort: 'name' });
  expect(selected.source.count).toBe(1);
  expect(index.page(selected.source, 0).map((card) => card.id)).toEqual([target.id]);
  const outside = all.cards.find((card) => card.id !== target.id)!;
  expect(() => index.update(outside)).toThrow('outside verification scope');
  expect(new ProjectIndex(global).query({ query: '', sort: 'name' })).toEqual(all);
});
