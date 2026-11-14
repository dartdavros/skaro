import assert from 'node:assert/strict';
import { expand } from '@skaro/core';
import type { Services } from '../app-services';

/** Leave one genuine stopped-service decision for the real Electron UI, with Stop still in force. */
export async function prepareDecisionRecoveryUi(s: Services, project: string) {
  const engine = s.runs['engine'];
  const task = (await s.projects.get(project).load()).tasks.find(
    (row) => row.title === 'Аудит штатного окружения Cat-pilot и допуска ресурсов RC-2',
  );
  assert(task);
  const active = await engine.history.restore(project, task.id);
  assert(active?.run.worktree);
  await s.runs.interrupt(project, task.id);
  const key = { projectId: project, taskId: task.id };
  await engine.environments.stop(key);
  const description = await engine.environments.describe(key);
  assert(description.config?.ready);
  const url = expand(description.config.ready, description.identity);
  await assert.rejects(fetch(url, { signal: AbortSignal.timeout(3000) }));
  const resource = await engine.environments.incidentResource(key);
  assert(resource);
  const policy = engine.incidents.policy.read(project);
  const confirmation = engine.incidents.policy.save(
    project,
    {
      ...policy,
      mode: 'confirm',
      expiresAt: Date.now() + 3600000,
    },
    policy.revision,
  );
  let incident: string | undefined;
  try {
    engine.continuation.execution(active).start();
    const row = await engine.incidents.report(
      active,
      `Actual readiness check failed: ${url}`,
      {
        cause: 'environment',
        code: 'verification_service_stopped',
        resourceId: resource.id,
        condition: 'environment-ready',
      },
      'controller',
    );
    incident = row.id;
    await engine.incidents.reconcile(project, row.id);
    const pending = engine.incidents.store.get(project, row.id);
    assert(pending.protocol!.decisionId);
    await s.runs.interrupt(project, task.id);
    assert.equal(engine.continuation.execution(active).read().enabled, false);
    return {
      project,
      task: task.id,
      run: active.run.id,
      incident: row.id,
      decision: pending.protocol!.decisionId,
      policy,
      policyRevision: confirmation.revision,
      turns: active.timeline.state.turns.length,
      head: await s.projects.get(project).git.head('HEAD', active.run.worktree),
      url,
      stoppedReadinessVerified: true,
    };
  } catch (error) {
    await s.runs.interrupt(project, task.id);
    if (incident) await engine.incidents.decisions.cancel(project, incident);
    const current = engine.incidents.policy.read(project);
    engine.incidents.policy.save(project, policy, current.revision);
    throw error;
  }
}
