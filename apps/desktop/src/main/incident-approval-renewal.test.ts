import { expect, it } from 'vitest';
import { remedyKey } from '@skaro/core';
import { observeIncidentApproval } from './incident-reply-test-support';
import { commitIncidentApproval } from './incident-answer-validation';
import { canRenewIncidentApproval } from './incident-approval-renewal';
import { incidentRequestIdentity } from './incident-request-identity';

it('requires a fresh canonical owner answer for retry after a known failed attempt, never an uncertain one', async () => {
  const o = await observeIncidentApproval();
  try {
    const { action } = o.prepared;
    commitIncidentApproval(o.db, o.policy, o.prepared, 'allow_once');
    o.policy.consume(action);
    const operation = `observed-attempt:${o.prepared.row.id}`;
    await expect(
      o.coordinators.execute(
        {
          id: operation,
          projectId: o.project.id,
          action: 'incident.remedy',
          source: { kind: 'controller', id: 'observation' },
          subject: o.prepared.row.subject,
          scopeKey: `remedy:${action.target}`,
          mode: 'control',
          inputHash: remedyKey(action),
        },
        async () => {
          throw new Error('Observed executor error');
        },
      ),
    ).rejects.toThrow();
    let row = o.store.update(o.store.get(o.project.id, o.prepared.row.id), {
      attempts: 1,
      operationId: operation,
      phase: 'waiting',
    });
    const eligible = () =>
      canRenewIncidentApproval(
        o.db,
        action,
        o.policy.read(o.project.id),
        o.policy.approval(action),
      );
    expect(eligible()).toBe(false);
    o.coordinators.reconcile(
      o.project.id,
      operation,
      { code: 'environment_start_failed_partial_effects_possible', refs: [row.subject] },
      'failed',
    );
    expect(eligible()).toBe(true);
    expect(o.policy.authority(action)).toBe('denied'); // Consumed permission alone still cannot run.
    const id = incidentRequestIdentity(o.db, row, action, 0);
    expect(id).not.toBe(o.prepared.decision.id);
    const decision = o.db.coordination.decisions.create({
      id,
      projectId: o.project.id,
      eventId: row.eventId,
      kind: 'approval',
      subject: o.prepared.decision.subject,
      inputHash: remedyKey(action),
    });
    const request = { ...o.prepared.request, expiresAt: Date.now() + 60000 };
    o.db.setSetting(`coordination.decision-action.${id}`, request);
    row = o.store.update(row, { decisionId: id });
    expect(incidentRequestIdentity(o.db, row, action, 0)).toBe(id);
    const prepared = { ...o.prepared, row, decision, request };
    o.policy.revoke(action);
    expect(eligible()).toBe(false);
    expect(() => commitIncidentApproval(o.db, o.policy, prepared, 'allow_once')).toThrow();
    // Restore the pre-revocation metadata only inside this isolated SQLite contract.
    o.db.setSetting(`coordination.approval.${o.project.id}.${remedyKey(action)}`, {
      ...o.policy.approval(action)!,
      revoked: false,
    });
    commitIncidentApproval(o.db, o.policy, prepared, 'allow_once');
    expect(o.policy.authority(action)).toBe('allowed');
    expect(o.db.coordination.decisions.get(o.project.id, id)?.state).toBe('answered');
    o.policy.consume(action);
    expect(() => commitIncidentApproval(o.db, o.policy, prepared, 'allow_once')).toThrow();
  } finally {
    await o.close();
  }
});
