import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { c4Hash } from '@skaro/core';
import { expect, it } from 'vitest';
import { C4Service, type C4ProposalRecord } from './c4-service';
import { C4AuditStore } from './c4-audit-store';
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
  const source = await readFile(join(w.store.root, spec.path), 'utf8');
  const heading = '## Требования';
  const proposal = {
    title: 'Pending specification amendment',
    summary: 'Changes the accepted specification before implementation planning.',
    baseRevision: artifacts.c4!.revision,
    model,
    documents: [
      {
        path: spec.path.replace(/^\.skaro\//, ''),
        baseHash: c4Hash(source),
        edits: [{ oldText: heading, newText: `${heading}\n\nAdditional owner-reviewed detail.` }],
      },
    ],
  };
  const scope = {
    kind: 'project_chat' as const,
    projectId: w.live.projectId,
    chatId: w.live.chat.id,
  };
  await expect(service.propose(proposal, scope)).rejects.toThrow('proposal authority');
  const auditChat = w.db.createChat({
    projectId: scope.projectId,
    agent: 'codex',
    title: 'C4',
    logPath: 'audit.jsonl',
  });
  const audits = new C4AuditStore(w.db, () => undefined);
  audits.update(audits.begin(scope.projectId), { chatId: auditChat.id, state: 'running' });
  const response = await service.propose(proposal, { ...scope, chatId: auditChat.id });
  expect(response.isError, response.text).not.toBe(true);
  const id = (JSON.parse(response.text) as { packageId: string }).packageId;
  expect(id).toBeTruthy();
  return {
    id,
    records: () => service.records(w.live.projectId),
  };
}

it('offers and applies a project plan while a separate manual C4 audit is waiting for review', async () => {
  const w = await planningWorkspace();
  try {
    const pkg = await architecture(w);
    const args = dialoguePlan();
    args.milestones = [args.milestones[0]!];
    args.expectedTotal = args.milestones[0]!.tasks.length;
    await w.engine.planning.prepare(w.live, args);
    await w.engine.planning.propose(w.live, { key: 'dialogue' });
    const [card] = w.engine.proposals.proposals(w.live);
    expect(card?.state).toBe('pending');
    await w.engine.planDecisions.accept(w.live, card!);
    await w.engine.planDecisions.drain(w.live);
    expect((await w.store.load()).tasks).toHaveLength(args.expectedTotal);
    expect(w.engine.proposals.proposals(w.live)[0]!.state).toBe('applied');
    expect((await pkg.records()).find((r) => r.item.id === pkg.id)?.item.state).toBe('pending');
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
