import assert from 'node:assert/strict';
import { totalmem } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expand } from '@skaro/core';
import type { Services } from '../app-services';
import { applicationResourceMeasurements } from '../resource-measurements';
import { environmentResourceCost } from '../resource-environment-cost';
import { RESOURCE_POLICY_KEY } from '../resource-policy';
import { eventually } from './resource-workflow-observation';
import { hasEnvironmentWait } from '../incident-environment-wait';
import { incidentAction } from '../incident-condition';

/** Existing real audit task, real host/VM metrics, normal MCP and Docker. No substitute services. */
export async function verifyEnvironmentAdmission(
  s: Services,
  project: string,
  proof: Record<string, unknown>,
) {
  const engine = s.runs['engine'];
  const context = s.projects.get(project);
  const task = (await context.load()).tasks.find(
    (t) => t.title === 'Аудит штатного окружения Cat-pilot и допуска ресурсов RC-2',
  );
  assert(task, 'Use the existing read-only audit task');
  const active = await engine.history.restore(project, task.id);
  assert(active?.run.worktree);
  const execution = engine.continuation.execution(active);
  assert(!execution.read().enabled, 'Do not overlap an authorized running task');
  const head = await context.git.head('HEAD', active.run.worktree);
  const scope = {
    kind: 'task' as const,
    projectId: project,
    taskId: task.id,
    runId: active.run.id,
  };
  let grant = s.mcp.grant(scope);
  const policy = s.db.getSetting<Record<string, number>>(RESOURCE_POLICY_KEY, {});
  const call = async (name: string) => {
    const response = await fetch(grant.url, {
      method: 'POST',
      headers: {
        ...grant.headers,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'tools/call',
        params: { name, arguments: {} },
      }),
      signal: AbortSignal.timeout(60000),
    });
    assert(response.ok);
    const result = await response.json();
    assert(!result.error, JSON.stringify(result.error));
    return result.result;
  };
  try {
    execution.start();
    const description = await engine.environments.describe({ projectId: project, taskId: task.id });
    proof.cost = await environmentResourceCost(s.db, s.dataDir, description, project);
    proof.hostAndDocker = await applicationResourceMeasurements(
      s.db,
      new Set(),
      new Set([s.dataDir, context.root]),
      true,
    );
    // Exercise a real owner budget cap, never assign fabricated free-memory observations.
    s.db.setSetting(RESOURCE_POLICY_KEY, { ...policy, reserveRamBytes: totalmem() });
    const before = performance.now();
    const waiting = await call('start_environment');
    assert(waiting.isError, JSON.stringify(waiting));
    proof.workerReturnedMs = performance.now() - before;
    let row = engine.incidents.store.get(project, execution.read().blockedIncident!);
    assert.equal(row.subject.kind, 'resource');
    assert.equal(row.protocol!.code, 'environment_waiting_resource');
    const action = await incidentAction(engine, row);
    assert(action && hasEnvironmentWait(engine, row, action));
    assert(!s.resources.holdings(project, `task:${task.id}`).length);
    assert(
      !s.db.coordination
        .pending(project)
        .some((o) => o.action === 'mcp.start_environment' && o.subject.id === task.id),
    );
    let repair = engine.incidents.reconcile(project, row.id);
    await eventually(
      () => s.db.admission.all(),
      (leases) =>
        leases.some(
          (l) => l.ownerId === `environment:${task.id}` && l.state === 'waiting_resource',
        ),
      'controller resource wait',
    );
    const configuration = await call('configure_environment');
    assert(!configuration.isError);
    await s.runs.interrupt(project, task.id);
    await repair;
    const stopped = engine.incidents.store.get(project, row.id);
    assert.equal(
      s.db.coordination.getOperation(project, stopped.protocol!.operationId!)?.state,
      'failed',
    );
    assert(!execution.read().enabled);
    proof.stopDuringWait = {
      operation: stopped.protocol!.operationId,
      state: 'failed',
      nativeStarted: false,
    };
    // A new, explicit bounded audit intent may request the same start again. Stop itself never resumes.
    execution.start();
    grant.revoke();
    grant = s.mcp.grant(scope);
    assert((await call('start_environment')).isError);
    row = engine.incidents.store.get(project, execution.read().blockedIncident!);
    assert.equal(row.protocol!.attempts, 0);
    repair = engine.incidents.reconcile(project, row.id);
    proof.wait = {
      incident: row.id,
      subject: row.subject,
      attempts: row.protocol!.attempts,
      waiting,
      configurationReadable: true,
    };
    s.db.setSetting(RESOURCE_POLICY_KEY, policy);
    // Prevent a full original task run: the actual bounded continuation below is read-only.
    const turns = active.timeline.state.turns.length;
    await repair;
    const resolved = engine.incidents.store.get(project, row.id);
    assert.equal(resolved.state, 'resolved');
    assert.equal(resolved.protocol!.attempts, 1);
    const running = await engine.environments.describe({ projectId: project, taskId: task.id });
    const url = expand(running.config!.ready!, running.identity);
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    assert(response.ok);
    assert.equal(
      await response.text(),
      await readFile(join(active.run.worktree, 'index.html'), 'utf8'),
    );
    const native = await eventually(
      () => s.runs.open(project, task.id),
      (view) =>
        !!view.timeline &&
        view.timeline.turns.length > turns &&
        !!view.timeline.turns.at(-1)?.outcome,
      'native continuation after verified environment',
      240000,
    );
    proof.recovered = {
      incident: resolved.id,
      operation: resolved.protocol!.operationId,
      ready: url,
      status: response.status,
      resumedTurn: native.timeline!.turns.at(-1),
      ownerQuestion: resolved.protocol!.decisionId ?? null,
    };
    assert.equal(await context.git.head('HEAD', active.run.worktree), head);
    await s.runs.interrupt(project, task.id);
    assert(!execution.read().enabled);
    proof.stopPreserved = true;
  } finally {
    grant.revoke();
    s.db.setSetting(RESOURCE_POLICY_KEY, policy);
    await s.runs.interrupt(project, task.id);
    await engine.environments.stop({ projectId: project, taskId: task.id });
  }
}
