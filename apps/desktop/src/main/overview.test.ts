import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDb, ArtifactStore } from '@skaro/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectCards } from './overview';
import { Projects } from './projects';

let root: string;
let db: AppDb;
let projects: Projects;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'skaro-overview-'));
  db = AppDb.open(':memory:');
  projects = new Projects(db, () => undefined);
});

afterEach(async () => {
  projects.close();
  db.close();
  await rm(root, { recursive: true, force: true });
});

describe('projectCards', () => {
  it('shows the first unfinished milestone, task statuses and running tasks', async () => {
    const store = new ArtifactStore(root);
    const m1 = await store.createMilestone({ title: 'API' });
    const m2 = await store.createMilestone({ title: 'Платежи' });
    const a = await store.createTask({ title: 'A', milestone: m1.id });
    await store.updateTask(a.id, { status: 'done' });
    const b = await store.createTask({ title: 'B', milestone: m2.id });
    // In review in a branch of its own: what depends on it waits for its merge. (A task that
    // works in the branch of the milestone would unblock the next one already in review.)
    await store.updateTask(b.id, { status: 'review', branch: 'skaro/b-own' });
    const c = await store.createTask({ title: 'C', milestone: m2.id, dependsOn: [b.id] });
    const d = await store.createTask({ title: 'D', milestone: m2.id });
    const project = db.addProject({ name: 'Shop', path: root });
    db.createRun({
      projectId: project.id,
      taskId: d.id,
      agent: 'codex',
      model: 'gpt-6-astra',
      logPath: 'x.jsonl',
      adapterVersion: '1',
    });
    db.setTaskRuntime(project.id, d.id, 'running');

    const [card] = await projectCards(db, projects);
    expect(card).toMatchObject({
      name: 'Shop',
      missing: false,
      milestone: { id: m2.id, title: 'Платежи', done: 0, total: 3 },
      counts: { working: 1, needs: 0, review: 1, failed: 0, blocked: 1 },
      running: [{ id: d.id, title: 'D', agent: 'codex', model: 'gpt-6-astra' }],
      agent: 'claude-code',
    });
    expect(c.dependsOn).toEqual([b.id]);
  });

  it('marks a project whose folder is gone', async () => {
    db.addProject({ name: 'Old', path: join(root, 'gone') });
    const [card] = await projectCards(db, projects);
    expect(card).toMatchObject({ name: 'Old', missing: true, running: [] });
    expect(card?.milestone).toBeUndefined();
  });
});
