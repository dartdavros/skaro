import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import type { Services } from '../app-services';
import { RESOURCE_POLICY_KEY } from '../resource-policy';

/** Real MCP request under an actual zero build-slot policy; no metrics or handlers are replaced. */
export async function verifyBuildCheckpoint(
  s: Services,
  project: string,
  task: string,
  policy: Record<string, number>,
  call: (name: string) => Promise<{ isError?: boolean }>,
  proof: Record<string, unknown>,
) {
  const engine = s.runs['engine'];
  const active = await engine.history.restore(project, task);
  assert(active);
  try {
    s.db.setSetting(RESOURCE_POLICY_KEY, { ...policy, build: 0 });
    const began = performance.now();
    const result = await call('start_environment');
    assert(result.isError);
    const elapsedMs = performance.now() - began;
    const lease = s.db.admission
      .all()
      .findLast((row) => row.ownerId === `task:${task}` && row.checkpoint === 'build');
    assert.equal(lease?.reason, 'budget_build');
    const incident = engine.continuation.execution(active).read().blockedIncident;
    assert(incident);
    assert.equal(
      engine.incidents.store.get(project, incident).protocol!.code,
      'environment_waiting_resource',
    );
    assert(!s.resources.holdings(project, `task:${task}`).length);
    assert(!s.resources.holdings(project, `environment:${task}`).length);
    await s.runs.interrupt(project, task);
    await engine.incidents.decisions.cancel(project, incident);
    proof.buildCheckpoint = {
      elapsedMs,
      lease: lease!.id,
      reason: lease!.reason,
      incident,
      workerReleased: true,
    };
  } finally {
    s.db.setSetting(RESOURCE_POLICY_KEY, policy);
  }
}
