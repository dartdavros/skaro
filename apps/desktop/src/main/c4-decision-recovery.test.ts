import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { DecisionReplies } from './decision-replies';
import { ProjectCoordinators } from './project-coordinators';
import { coordinationHash } from './project-coordinator-request';
import { recoverC4DecisionReply } from './c4-decision-recovery';
import type { ProjectDecision } from '../shared/project-decisions';
import type { C4ProposalRecord } from './c4-service';

// Causality/receipt metadata only; no model, checkout, backend, agent or filesystem fixture.
it('closes the original uncertain reply only after verified application, without executing its effect twice', async () => {
  const db = AppDb.open(':memory:');
  const project = db.addProject({ name: 'C4 receipt metadata', path: process.cwd() });
  const controllers = new ProjectCoordinators(db);
  controllers.recover();
  try {
    const record: C4ProposalRecord = {
      scope: { kind: 'project_chat', projectId: project.id, chatId: 'original-chat' },
      package: {
        id: 'original-package',
        title: 'Metadata',
        summary: 'Protocol',
        baseRevision: 1,
        files: [],
      },
      item: {
        id: 'original-package',
        kind: 'proposal',
        state: 'pending',
        status: 'done',
        turnId: '',
        startedAt: 0,
        native: { agent: 'skaro', type: 'proposal', ref: 'architecture' },
        proposal: {
          type: 'architecture',
          packageId: 'original-package',
          title: 'Metadata',
          summary: 'Protocol',
          baseRevision: 1,
        },
      },
    };
    const entry: ProjectDecision = {
      kind: 'proposal',
      id: record.item.id,
      revision: 'original-revision',
      item: record.item,
      origin: {
        projectId: project.id,
        kind: 'chat',
        id: 'original-chat',
        title: 'Metadata',
        epoch: 'original-log',
      },
    };
    const answer = {
      kind: 'proposal' as const,
      action: { action: 'apply' as const, fingerprint: 'original-fingerprint' },
    };
    const replies = new DecisionReplies(db);
    let effects = 0;
    await expect(
      replies.accept(
        entry,
        answer,
        async () => undefined,
        () =>
          controllers.execute(
            {
              id: 'original-ipc',
              projectId: project.id,
              action: 'ipc.c4.decide',
              source: { kind: 'owner', id: 'original-owner' },
              subject: { kind: 'decision', id: record.item.id },
              mode: 'mutation',
              scopeKey: 'project',
              expectedVersion: 0,
              inputHash: coordinationHash([
                project.id,
                record.item.id,
                'apply',
                answer.action.fingerprint,
              ]),
            },
            async () => {
              effects++;
              throw new Error('Unknown physical result');
            },
          ),
      ),
    ).rejects.toThrow('Unknown physical result');
    record.item = { ...record.item, state: 'accepted' };
    recoverC4DecisionReply(db, record);
    expect(replies.status(entry)).toBeUndefined();
    expect(db.coordination.getOperation(project.id, 'original-ipc')?.state).toBe('uncertain');
    record.item = { ...record.item, state: 'applied' };
    recoverC4DecisionReply(db, record);
    expect(replies.status(entry)).toBe('answered');
    expect(db.coordination.getOperation(project.id, 'original-ipc')?.state).toBe('succeeded');
    await replies.accept(
      entry,
      answer,
      async () => {
        throw new Error('No fresh question');
      },
      async () => {
        effects++;
      },
    );
    recoverC4DecisionReply(db, record);
    expect(effects).toBe(1);
  } finally {
    await controllers.close();
    db.close();
  }
});
