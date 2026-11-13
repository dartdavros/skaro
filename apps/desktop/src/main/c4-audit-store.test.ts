import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { C4AuditStore } from './c4-audit-store';
import { mapC4Operations } from './c4-audit-migration';
import { reconcileC4Audit } from './c4-audit-status';
import type { C4ProposalRecord } from './c4-service';
import { canonicalC4Decisions } from './c4-decision-sources';
import { emptyTimeline } from '@skaro/timeline';
import { projectDecisionProjection } from './decision-projection';

// SQLite and protocol metadata only. No checkout, backend, native agent or generated project files.
it('reuses an explicit launch, preserves Stop on reopen and requires its ID for a fresh launch', () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'Audit protocol metadata', path: process.cwd() });
    const store = new C4AuditStore(db, () => undefined);
    const first = store.begin(project.id);
    expect(store.begin(project.id).id).toBe(first.id);
    store.update(first, { state: 'stopped' });
    const restored = new C4AuditStore(db, () => undefined);
    expect(restored.read(project.id)?.state).toBe('stopped');
    expect(restored.begin(project.id).id).toBe(first.id);
    const next = restored.begin(project.id, first.id);
    expect(next.id).not.toBe(first.id);
    expect(() => store.update(first, { state: 'running' })).toThrow('no longer current');
  } finally {
    db.close();
  }
});

it('maps both protocols without rewriting pending bytes and preserves accepted conflicts without another decision', () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'C4 route metadata', path: process.cwd() });
    const store = new C4AuditStore(db, () => undefined);
    const audit = store.update(store.begin(project.id), { chatId: 'audit-chat' });
    for (const protocol of ['package-v1', 'impact-v1'] as const) {
      const record: C4ProposalRecord = {
        protocol,
        scope: { kind: 'project_chat', projectId: project.id, chatId: 'audit-chat' },
        package: {
          id: protocol,
          title: 'Route metadata',
          summary: 'Protocol only',
          baseRevision: 1,
          files: [],
        },
        item: {
          id: protocol,
          kind: 'proposal',
          turnId: '',
          status: 'done',
          state: 'pending',
          startedAt: 0,
          native: { agent: 'skaro', type: 'proposal', ref: 'architecture' },
          proposal: {
            type: 'architecture',
            packageId: protocol,
            title: 'Route metadata',
            summary: 'Protocol only',
            baseRevision: 1,
          },
        },
      };
      const original = JSON.stringify(record);
      expect(mapC4Operations(db, project.id, [record])[0]?.state).toBe('pending');
      expect(JSON.stringify(record)).toBe(original);
      record.item = {
        ...record.item,
        state: 'accepted',
        result: { error: 'Observed physical conflict' },
      };
      expect(mapC4Operations(db, project.id, [record])[0]?.state).toBe('accepted');
      expect(reconcileC4Audit(store, db, audit, [record]).state).toBe('conflict');
      expect(record.item.state).toBe('accepted');
      const source = {
        projectId: project.id,
        id: 'audit-chat',
        kind: 'chat' as const,
        title: 'Audit',
        epoch: 'original-log',
        timeline: emptyTimeline(),
      };
      source.timeline.items = [{ ...record.item, state: 'pending' }];
      expect(projectDecisionProjection([canonicalC4Decisions(source, [record])])).toEqual([]);
      record.item = { ...record.item, state: 'pending' };
      source.timeline.items = [];
      expect(projectDecisionProjection([canonicalC4Decisions(source, [record])])).toHaveLength(1);
      expect(() =>
        mapC4Operations(db, project.id, [
          { ...record, package: { ...record.package, summary: 'Changed bytes' } },
        ]),
      ).toThrow('identity changed');
    }
  } finally {
    db.close();
  }
});
