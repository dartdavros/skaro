import { expect, it } from 'vitest';
import { incidentHash, remedyKey } from '@skaro/core';
import { observeIncidentApproval } from './incident-reply-test-support';
import { hasEnvironmentWait } from './incident-environment-wait';
import { IncidentDispatchAuthority } from './incident-dispatch-authority';

it('expires a transferred wait before entry but preserves admitted work while retaining revocation', async () => {
  const o = await observeIncidentApproval();
  try {
    const action = { ...o.prepared.action, kind: 'environment.start' as const };
    const row = o.store.update(o.prepared.row, { attempts: 1, phase: 'executing' });
    const ctx = { deps: { db: o.db }, incidents: { policy: o.policy } };
    o.db.setSetting(`coordination.environment-wait.${row.id}`, {
      action: remedyKey(action),
      subscriptions: incidentHash(row.protocol!.subscriptions),
      policy: 0,
      expiresAt: 1000,
    });
    expect(hasEnvironmentWait(ctx, row, action, true, 100)).toBe(true);
    const authority = new IncidentDispatchAuthority(action);
    authority.acceptTransfer(100);
    authority.enter();
    expect(hasEnvironmentWait(ctx, row, action, true, 2000)).toBe(false);
    expect(hasEnvironmentWait(ctx, row, action, true, authority.time(2000))).toBe(true);
    o.policy.revoke(action);
    expect(hasEnvironmentWait(ctx, row, action, true, authority.time(2000))).toBe(false);
  } finally {
    await o.close();
  }
});
