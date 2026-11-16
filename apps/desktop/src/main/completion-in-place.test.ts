import { afterEach, expect, it } from 'vitest';
import { AppDb, type ProjectArtifacts, type Task } from '@skaro/core';
import { recordInPlaceResult } from './completion-in-place';
import { CompletionStore, criteriaRevision } from './completion-store';
import type { C4TaskReview } from './c4-review';

// Native SQLite and metadata DTOs only: no project checkout, services or seeded environment.
const databases: AppDb[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function database() {
  const db = AppDb.open(':memory:');
  databases.push(db);
  return db;
}
const task: Task = {
  id: 'T-002',
  title: 'Accepted source',
  status: 'in_progress',
  dependsOn: [],
  unblocked: false,
  archived: false,
  path: '.skaro/tasks/T-002.md',
  body: '## Goal\nPreserve the source\n\n## Acceptance criteria\n- [x] Source verified\n',
};
const c4: C4TaskReview = {
  runId: 'run',
  baseHead: 'base',
  modelHash: 'model',
  changeHash: 'committed-source',
  revision: 1,
  elements: [],
  relationships: [],
  realized: [],
  aligned: true,
  evidence: 'Reviewed',
};
const commit = {
  head: 'immutable-commit',
  branch: 'refs/skaro/results/T-002/immutable-commit',
  c4,
};
const artifacts = (tasks: Task[]) => ({ tasks }) as ProjectArtifacts;

it('durably saves exact in-place acceptance before done without changing the task DTO', () => {
  const db = database();
  const result = recordInPlaceResult(db, 'project', artifacts([task]), task, commit, {
    message: 'feat: preserve accepted code',
    summary: 'Verified source',
    verification: [{ name: 'Changed behavior', run: 'check-changed' }],
  });
  expect(new CompletionStore(db, 'project').result(task.id)).toEqual(result);
  expect(result).toMatchObject({
    ...commit,
    inPlace: true,
    sharedCheckout: true,
    pendingReview: true,
    criteria: criteriaRevision(task),
    dependencies: [],
    summary: 'Verified source',
    verification: [{ name: 'Changed behavior', run: 'check-changed' }],
  });
  expect(task.status).toBe('in_progress');
});

it('preserves transitive inputs and rejects a dependency replaced since preflight', () => {
  const db = database();
  const store = new CompletionStore(db, 'project');
  const dependency: Task = { ...task, id: 'T-001', status: 'done' };
  const inherited: Task = { ...task, id: 'T-000', status: 'done' };
  const dependent = { ...task, dependsOn: [dependency.id] };
  const sources = artifacts([dependent, dependency, inherited]);
  store.saveResult({
    taskId: inherited.id,
    head: 'ancestor',
    branch: 'main',
    message: '',
    criteria: criteriaRevision(inherited),
  });
  const accepted = {
    taskId: dependency.id,
    head: 'input',
    branch: 'main',
    message: '',
    criteria: criteriaRevision(dependency),
    dependencies: [{ taskId: inherited.id, head: 'ancestor' }],
  };
  store.saveResult(accepted);
  db.setSetting('coordination.inputs.run', {
    dependencies: [{ taskId: dependency.id, head: 'input' }],
  });
  expect(recordInPlaceResult(db, 'project', sources, dependent, commit, {}).dependencies).toEqual([
    { taskId: dependency.id, head: 'input' },
    { taskId: inherited.id, head: 'ancestor' },
  ]);
  store.saveResult({ ...accepted, head: 'replaced' });
  expect(() => recordInPlaceResult(db, 'project', sources, dependent, commit, {})).toThrow(
    'changed after preflight',
  );
  expect(store.result(task.id)?.dependencies?.[0]?.head).toBe('input');
});

it('does not record incomplete criteria or a dependency known only by its done status', () => {
  const db = database();
  const store = new CompletionStore(db, 'project');
  const unfinished = { ...task, body: task.body.replace('[x]', '[ ]') };
  expect(() =>
    recordInPlaceResult(db, 'project', artifacts([unfinished]), unfinished, commit, {}),
  ).toThrow('unfinished');
  const dependent = { ...task, dependsOn: ['T-001'] };
  expect(() =>
    recordInPlaceResult(db, 'project', artifacts([dependent]), dependent, commit, {}),
  ).toThrow('no accepted result');
  expect(store.result(task.id)).toBeUndefined();
});
