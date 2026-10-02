import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDb, ArtifactStore } from '@skaro/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { milestoneBody, milestoneSections, Plan } from './plan';
import { Projects } from './projects';

describe('milestone sections', () => {
  it('reads the goal and the done criterion in both languages', () => {
    expect(
      milestoneSections(
        '## Цель\n\nПринимать оплату.\n\n## Критерий готовности\n\nВсё работает.\n',
      ),
    ).toEqual({
      goal: 'Принимать оплату.',
      criteria: 'Всё работает.',
    });
    expect(milestoneSections('## Goal\nShip it\n## Done when\nIt ships')).toEqual({
      goal: 'Ship it',
      criteria: 'It ships',
    });
  });

  it('writes what it reads back', () => {
    const body = milestoneBody({ title: 'M', goal: 'A goal', criteria: 'A criterion' }, 'ru');
    expect(milestoneSections(body)).toEqual({ goal: 'A goal', criteria: 'A criterion' });
  });

  it('skips empty sections', () => {
    expect(milestoneSections('## Цель\n\n## Критерий готовности\n')).toEqual({});
  });
});

describe('plan changes', () => {
  let root: string;
  let db: AppDb;
  let projects: Projects;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'skaro-plan-'));
    db = AppDb.open(':memory:');
    projects = new Projects(db, () => undefined);
  });

  afterEach(async () => {
    projects.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  });

  const planOf = () =>
    new Plan({
      projects,
      emit: () => undefined,
      deleteTasks: async (projectId, ids) => {
        for (const id of ids) await projects.get(projectId).store.deleteTask(id);
      },
    });

  it('takes a task out of its milestone into "Без этапа" and back', async () => {
    const store = new ArtifactStore(root);
    const m = await store.createMilestone({ title: 'API' });
    const a = await store.createTask({ title: 'A', milestone: m.id });
    const b = await store.createTask({ title: 'B' });
    const project = db.addProject({ name: 'Shop', path: root });
    const plan = planOf();

    await plan.placeTask(project.id, a.id, '', 0);
    let tasks = (await new ArtifactStore(root).load()).tasks;
    expect(tasks.map((t) => [t.id, t.milestone, t.order])).toEqual([
      [a.id, undefined, 1],
      [b.id, undefined, 2],
    ]);

    await plan.placeTask(project.id, b.id, m.id, 0);
    tasks = (await new ArtifactStore(root).load()).tasks;
    expect(tasks.find((t) => t.id === b.id)?.milestone).toBe(m.id);
  });

  it('deletes a milestone with its tasks only while none of them is started', async () => {
    const store = new ArtifactStore(root);
    const fresh = await store.createMilestone({ title: 'Fresh' });
    const begun = await store.createMilestone({ title: 'Begun' });
    await store.createTask({ title: 'A', milestone: fresh.id });
    const b = await store.createTask({ title: 'B', milestone: begun.id });
    await store.updateTask(b.id, { status: 'done', archived: true });
    const project = db.addProject({ name: 'Shop', path: root });
    const plan = planOf();

    await expect(plan.delete(project.id, begun.id)).rejects.toThrow('started tasks');
    await plan.delete(project.id, fresh.id);
    const left = await new ArtifactStore(root).load();
    expect(left.milestones.map((m) => m.id)).toEqual([begun.id]);
    expect(left.tasks.map((t) => t.id)).toEqual([b.id]);
  });
});
