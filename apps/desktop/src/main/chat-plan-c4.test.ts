import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { C4Service, type C4ProposalRecord } from './c4-service';
import { unresolvedPlanPackages } from './chat-plan-c4';
import { dialoguePlan, planningWorkspace } from './chat-planning-test-workspace';

async function architecture(w: Awaited<ReturnType<typeof planningWorkspace>>) {
  const service = new C4Service({
    db: w.db,
    projects: w.engine.deps.projects,
    locale: () => 'en',
    publish: async () => undefined,
    changed: () => undefined,
    stageImport: async () => {
      throw new Error('Not an import');
    },
  });
  const artifacts = await w.store.load();
  const model = structuredClone(artifacts.c4!);
  model.revision++;
  const spec = artifacts.specs[0]!;
  const response = await service.propose(
    {
      title: 'Pending specification amendment',
      summary: 'Changes the accepted specification before implementation planning.',
      baseRevision: artifacts.c4!.revision,
      model,
      documents: [
        {
          path: spec.path.replace(/^\.skaro\//, ''),
          content:
            (await readFile(join(w.store.root, spec.path), 'utf8')) +
            '\nAdditional owner-reviewed detail.\n',
        },
      ],
    },
    { kind: 'project_chat', projectId: w.live.projectId, chatId: w.live.chat.id },
  );
  const id = (JSON.parse(response.text) as { packageId: string }).packageId;
  return {
    id,
    records: () => service.records(w.live.projectId),
    async apply() {
      const review = await service.reviewPackage(w.live.projectId, id);
      await service.decide(w.live.projectId, id, 'apply', review.fingerprint);
    },
  };
}

it('waits for the pending amendment even when the old specification is accepted', async () => {
  const w = await planningWorkspace();
  try {
    const pkg = await architecture(w);
    expect((await w.store.load()).specs[0]!.status).toBe('accepted');
    expect(
      await w.engine.plan.checkTasks(
        w.live,
        await w.store.load(),
        dialoguePlan().milestones[0]!.tasks,
      ),
    ).toContain(pkg.id);
    await w.engine.planning.prepare(w.live, dialoguePlan());
    const response = await w.engine.planning.propose(w.live, { key: 'dialogue' });
    expect(response.text).toContain(pkg.id);
    expect(w.engine.planning.store(w.live).get('dialogue')!.state).toBe('waiting');
    expect(w.engine.proposals.proposals(w.live)).toHaveLength(0);
    expect((await pkg.records())[0]!.item.state).toBe('pending');
    expect((await w.store.load()).tasks).toHaveLength(0);
    w.engine.planningContinuation.schedule(w.live);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await w.engine.planningContinuation.settled(w.live);
    expect(w.engine.planning.store(w.live).get('dialogue')!.state).toBe('waiting');
    expect(w.live.session).toBeUndefined();

    // Only this explicit fixture-owner decision changes the package state.
    await pkg.apply();
    expect((await pkg.records())[0]!.item.state).toBe('applied');
    await w.engine.planning.propose(w.live, { key: 'dialogue' });
    expect(w.engine.proposals.proposals(w.live)).toHaveLength(1);
  } finally {
    await w.close();
  }
});

it('rechecks durable packages before accepting an already offered plan and during recovery', async () => {
  const w = await planningWorkspace();
  try {
    const args = dialoguePlan();
    args.milestones = [args.milestones[0]!];
    args.expectedTotal = args.milestones[0]!.tasks.length;
    await w.engine.planning.prepare(w.live, args);
    await w.engine.planning.propose(w.live, { key: 'dialogue' });
    const card = w.engine.proposals.proposals(w.live)[0]!;
    const pkg = await architecture(w);
    // The package is intentionally absent from this chat's in-memory timeline.
    await expect(w.engine.planDecisions.accept(w.live, card)).rejects.toThrow(pkg.id);
    expect(w.engine.proposals.proposals(w.live)[0]!.state).toBe('pending');
    expect((await w.store.load()).tasks).toHaveLength(0);
    await pkg.apply();
    await w.engine.planDecisions.accept(w.live, card);
    const next = await architecture(w);
    await w.engine.planDecisions.drain(w.live);
    expect((await w.store.load()).tasks).toHaveLength(0);
    expect(w.engine.proposals.proposals(w.live)[0]!.result?.error).toContain(next.id);
    expect((await next.records()).find((r) => r.item.id === next.id)!.item.state).toBe('pending');
    await next.apply();
    await w.engine.planDecisions.drain(w.live);
    expect((await w.store.load()).tasks).toHaveLength(args.expectedTotal);
    expect(w.engine.proposals.proposals(w.live)[0]!.state).toBe('applied');
  } finally {
    await w.close();
  }
});

it('blocks only related open packages, including explicit package dependencies without a spec', () => {
  const id = 'skaro-c4-358626c8-fcc5-4d68-aa19-9f992e546180';
  const record = {
    item: { id, state: 'pending' },
    package: { files: [{ path: 'specs/0001-feature.md' }] },
  } as C4ProposalRecord;
  expect(unresolvedPlanPackages([{ spec: '1' }], [record])).toEqual([id]);
  expect(unresolvedPlanPackages([{ spec: '0002' }], [record])).toEqual([]);
  expect(unresolvedPlanPackages([{ body: `Requires ${id}` }], [record])).toEqual([id]);
  record.fileIndex = [{ path: 'specs/0001-feature.md', beforeHash: 'old', afterHash: 'new' }];
  record.package.files = [];
  record.item.state = 'accepted';
  expect(unresolvedPlanPackages([{ spec: '0001' }], [record])).toEqual([id]);
  for (const state of ['applied', 'rejected'] as const) {
    record.item.state = state;
    expect(unresolvedPlanPackages([{ spec: '0001' }], [record])).toEqual([]);
  }
  expect(unresolvedPlanPackages([{ body: `Requires ${id}` }], [record])).toEqual([id]);
});
