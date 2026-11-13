import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Services } from '../app-services';
import type { ArchiagentStatus } from '../../shared/archiagent-activation';
import { sessionHandlers } from '../session-handlers';
import { archiagentBaseline, assertArchiagentPreserved } from './archiagent-baseline';

const expected = (state: ArchiagentStatus) => ({
  dispatchRevision: state.dispatch.revision,
  activationRevision: state.activation?.revision ?? 0,
  protocol: state.protocol,
  eligibility: state.eligibility,
});
export async function verifyArchiagentActivation(s: Services, project: string, data: string) {
  const handlers = sessionHandlers(s),
    before = await archiagentBaseline(s, project, data);
  const decisions = await handlers['decisions.list'](project);
  const stopped = s.db
    .listRuns(project)
    .filter(
      (run) =>
        !s.db.getSetting<{ enabled: boolean }>(`execution.${run.id}`, { enabled: false }).enabled,
    )
    .map((run) => run.id);
  const initial = await handlers['archiagent.status'](project);
  assert(initial.compatible && initial.dispatch.enabled);
  await handlers['coordinator.setDispatch'](project, false, initial.dispatch.revision);
  const off = await handlers['archiagent.status'](project),
    input = expected(off),
    id = `ag1-enable-${randomUUID()}`;
  const enabled = await handlers['archiagent.activate'](project, 'impact-v1', input, id);
  assert(enabled.dispatch.enabled && enabled.compatible && enabled.protocol === 'impact-v1');
  assert.deepEqual(await handlers['archiagent.activate'](project, 'impact-v1', input, id), enabled);
  await assert.rejects(async () =>
    handlers['c4.selectProtocol'](project, 'package-v1', 'impact-v1'),
  );
  await handlers['coordinator.setDispatch'](project, false, enabled.dispatch.revision);
  await assert.rejects(async () =>
    handlers['archiagent.activate'](project, 'impact-v1', input, id),
  );
  const held = await handlers['archiagent.status'](project);
  assert.equal(held.dispatch.enabled, false);
  const rollback = await handlers['archiagent.activate'](
    project,
    'package-v1',
    expected(held),
    `ag1-compatible-rollback-${randomUUID()}`,
  );
  assert.equal(rollback.protocol, 'package-v1');
  await handlers['coordinator.setDispatch'](project, false, rollback.dispatch.revision);
  const fresh = await handlers['archiagent.status'](project);
  const final = await handlers['archiagent.activate'](
    project,
    'impact-v1',
    expected(fresh),
    `ag1-final-enable-${randomUUID()}`,
  );
  assert(final.dispatch.enabled && final.compatible && final.protocol === 'impact-v1');
  assert.deepEqual(await handlers['decisions.list'](project), decisions);
  for (const id of stopped)
    assert.equal(
      s.db.getSetting<{ enabled: boolean }>(`execution.${id}`, { enabled: false }).enabled,
      false,
    );
  return {
    initial,
    enabled,
    rollback,
    final,
    pendingDecisionsPreserved: decisions.map((decision) => decision.id),
    stoppedRunsPreserved: stopped,
    preservation: await assertArchiagentPreserved(before, s, project, data),
  };
}
