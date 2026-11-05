import { AppDb, ArtifactStore } from '@skaro/core';
import type { ProposedTask } from '@skaro/timeline';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanProposal } from './chat-model';
import { applyChatPlan } from './chat-plan-apply';
import { planSpecProblem } from './chat-plan-specs';
import { prepareFixtureArchitecture } from './c4-test-support';
import { closeBackground } from './background/client';

let root: string;
let store: ArtifactStore;
let db: AppDb;
let projectId: string;
const implementation: ProposedTask = {
  ref: 'api',
  title: 'Добавить API черновика',
  body: '## Цель\n\nГенерировать черновик.',
  dependsOn: [],
  dependsOnTitles: [],
  spec: '0001',
};
const roadmap: PlanProposal = {
  type: 'plan',
  milestone: { id: 'M01', title: 'ИИ-черновик', isNew: true },
  tasks: [],
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'skaro-plan-regression-'));
  store = new ArtifactStore(root);
  db = AppDb.open(join(root, 'skaro.db'));
  projectId = db.addProject({ name: 'Plan regression', path: root }).id;
});
afterEach(async () => {
  await closeBackground();
  db.close();
  await rm(root, { recursive: true, force: true });
});

async function apply(proposal: PlanProposal, picked?: string[]) {
  return applyChatPlan({
    store,
    artifacts: await store.load(),
    db,
    projectId,
    items: [],
    proposal,
    ...(picked !== undefined ? { picked } : {}),
  });
}

async function acceptedSpec() {
  const spec = await store.createSpec({ title: 'Черновик' });
  await prepareFixtureArchitecture(root, [spec.id]);
  return spec;
}

describe('project plan application with real persistence', () => {
  it('rejects deselecting a required predecessor before any milestone, task or event is written', async () => {
    await acceptedSpec();
    const second = {
      ...implementation,
      ref: 'save',
      title: 'Сохранить черновик',
      dependsOn: ['api'],
      dependsOnTitles: [implementation.title],
    };
    await expect(apply({ ...roadmap, tasks: [implementation, second] }, ['save'])).rejects.toThrow(
      'dependencies are not created or selected',
    );
    const artifacts = await store.load();
    expect(artifacts.tasks).toHaveLength(0);
    expect(artifacts.milestones).toHaveLength(0);
    expect(db.listEvents(projectId)).toHaveLength(0);
  });
  it('creates an empty milestone without task files or a tasks_created event', async () => {
    const applied = await apply(roadmap, []);
    expect(applied.result).toEqual({ milestone: { id: 'M01', title: 'ИИ-черновик' }, tasks: [] });
    const artifacts = await store.load();
    expect(artifacts.milestones.map((m) => m.id)).toEqual(['M01']);
    expect(artifacts.tasks).toEqual([]);
    expect(db.listEvents(projectId).map((e) => e.kind)).toEqual(['milestone_created']);
    expect(applied.note).toContain('without tasks');
  });

  it('does not treat deselecting every proposed task as an empty roadmap', async () => {
    await expect(apply({ ...roadmap, tasks: [implementation] }, [])).rejects.toThrow(
      'No tasks are selected',
    );
    expect((await store.load()).milestones).toEqual([]);
  });

  it('links implementation tasks to accepted specs while preserving dependencies', async () => {
    await acceptedSpec();
    const second = {
      ...implementation,
      ref: 'save',
      title: 'Сохранить черновик',
      dependsOn: ['api'],
      dependsOnTitles: [implementation.title],
    };
    const applied = await apply({
      ...roadmap,
      tasks: [{ ...implementation, spec: 'SPEC-0001' }, second],
    });
    const tasks = (await store.load()).tasks;
    expect(tasks.map((t) => t.spec)).toEqual(['0001', '0001']);
    expect(tasks[1]?.dependsOn).toEqual([applied.result.tasks?.[0]?.id]);
  });

  it.each(['proposed', 'superseded', 'missing'] as const)(
    'rejects a %s spec before writing any milestone or task',
    async (status) => {
      if (status !== 'missing') await store.createSpec({ title: 'Черновик', status });
      const artifacts = await store.load();
      expect(planSpecProblem([implementation], artifacts.specs)).toContain(
        'accepted specifications',
      );
      await expect(apply({ ...roadmap, tasks: [implementation] })).rejects.toThrow(
        'accepted specifications',
      );
      const unchanged = await store.load();
      expect(unchanged.milestones).toEqual([]);
      expect(unchanged.tasks).toEqual([]);
      expect(db.listEvents(projectId)).toEqual([]);
    },
  );

  it('rechecks spec acceptance after a valid proposal, before the user applies it', async () => {
    const spec = await acceptedSpec();
    expect(planSpecProblem([implementation], (await store.load()).specs)).toBeUndefined();
    await store.setSpecStatus(spec.id, 'superseded');
    await expect(apply({ ...roadmap, tasks: [implementation] })).rejects.toThrow(
      'accepted specifications',
    );
    expect((await store.load()).tasks).toEqual([]);
  });

  it('still permits a small fix without a specification', async () => {
    const { spec: _spec, ...fix } = implementation;
    await apply({ type: 'plan', tasks: [fix] });
    expect((await store.load()).tasks).toHaveLength(1);
  });
});
