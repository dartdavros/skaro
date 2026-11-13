import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';
import { coordinatorQuota } from './coordinator-quota-live';

/** Uses the real configured account cap, never a simulated provider outage. */
export async function verifyArchiagentQuota(s: Services, project: string) {
  const handlers = sessionHandlers(s);
  const events = s.db.listEvents(project, 10000).length;
  const result = await coordinatorQuota(s, project, async () => {
    const state = await handlers['archiagent.status'](project);
    assert(!state.dispatch.enabled && state.compatible);
    await assert.rejects(async () =>
      handlers['coordinator.setDispatch'](project, true, state.dispatch.revision),
    );
    return handlers['archiagent.activate'](
      project,
      state.protocol,
      {
        dispatchRevision: state.dispatch.revision,
        activationRevision: state.activation?.revision ?? 0,
        protocol: state.protocol,
        eligibility: state.eligibility,
      },
      `ag1-quota-renew-${randomUUID()}`,
    );
  });
  return {
    ...result,
    newEvents: s.db.listEvents(project, 10000).length - events,
    providerOutageTested: false,
    crossProjectLiveTested: false,
  };
}
