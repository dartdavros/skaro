import { expect, it } from 'vitest';
import { observeIncidentApproval } from './incident-reply-test-support';
import { incidentRequestIdentity } from './incident-request-identity';

it('renews an expired request with a distinct identity and keeps the renewed live request stable', async () => {
  const o = await observeIncidentApproval();
  try {
    const { row, action, decision, request } = o.prepared;
    expect(incidentRequestIdentity(o.db, row, action, 0)).toBe(decision.id);
    o.db.setSetting(`coordination.decision-action.${decision.id}`, { ...request, expiresAt: 0 });
    const renewedId = incidentRequestIdentity(o.db, row, action, 0);
    expect(renewedId).not.toBe(decision.id);
    expect(incidentRequestIdentity(o.db, row, action, 0)).toBe(renewedId);
    o.db.coordination.decisions.create({
      id: renewedId,
      projectId: row.projectId,
      eventId: row.eventId,
      kind: 'approval',
      subject: decision.subject,
      inputHash: decision.inputHash,
    });
    o.db.setSetting(`coordination.decision-action.${renewedId}`, request);
    const renewed = o.store.update(row, { decisionId: renewedId });
    expect(incidentRequestIdentity(o.db, renewed, action, 0)).toBe(renewedId);
  } finally {
    await o.close();
  }
});
