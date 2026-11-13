import assert from 'node:assert/strict';
import { BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expand, remedyKey } from '@skaro/core';
import type { Services } from '../app-services';
import { checkIncident, incidentAction } from '../incident-condition';
import { finishedTask, eventually, requireReleased } from './resource-workflow-observation';

/** Real task, actual stopped Compose service and native worker; no substitute backend or task seed. */
export async function verifyIncidentRecovery(
  s: Services,
  projectId: string,
  taskId: string,
  proof: Record<string, unknown>,
  directory: string,
) {
  const engine = s.runs['engine'],
    incidents = engine.incidents;
  const policy = incidents.policy.read(projectId),
    task = { projectId, taskId };
  const active = await engine.history.restore(projectId, taskId);
  assert(active?.run.worktree);
  const initialHead = await s.projects.get(projectId).git.head('HEAD', active.run.worktree);
  const execution = engine.continuation.execution(active);
  let window: BrowserWindow | undefined;
  const setPolicy = (mode: 'confirm' | 'automatic' | 'delegated', target: string) =>
    incidents.policy.save(
      projectId,
      {
        mode,
        expiresAt: Date.now() + 3600000,
        rules: [{ kind: 'environment.start', target, maxCostUsd: 0 }],
        denied: [],
      },
      incidents.policy.read(projectId).revision,
    );
  try {
    await s.runs.interrupt(projectId, taskId);
    const description = await engine.environments.describe(task);
    await engine.environments.stop(task);
    const resource = s.db.resources
      .list(projectId)
      .find(
        (r) =>
          r.kind === 'environment' &&
          r.owner.kind === 'task' &&
          r.owner.id === taskId &&
          r.ownership === 'registered',
      );
    assert(resource, 'Use the actual registered audit environment');
    const url = expand(description.config!.ready!, description.identity);
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(4000) }));
    const details = {
      cause: 'environment' as const,
      code: 'service_unavailable',
      resourceId: resource.id,
      condition: 'environment-ready' as const,
    };
    execution.start(); // This driver is the owner's explicit, bounded audit execution intent.
    process.send?.({ stage: 'actual-environment-incident' });
    const rows = await Promise.all([
      incidents.report(active, `Readiness failed at ${url}`, details, 'controller'),
      incidents.report(
        active,
        `The same registered service is stopped: ${url}`,
        details,
        'controller',
      ),
    ]);
    const row = rows[0]!;
    assert.equal(row.id, rows[1]!.id);
    assert.equal(incidents.store.get(projectId, row.id).protocol!.attempts, 0);
    setPolicy('confirm', resource.id);
    await incidents.reconcile(projectId, row.id);
    const pending = incidents.store.get(projectId, row.id);
    assert(pending.protocol!.decisionId);
    const decisionId = pending.protocol!.decisionId;
    assert(active.timeline.state.interactions.some((i) => i.id === `coordinator:${decisionId}`));
    await incidents.reconcile(projectId, row.id);
    assert.equal(incidents.store.get(projectId, row.id).protocol!.decisionId, decisionId);
    requireReleased(s, projectId, `task:${taskId}`);
    // Stop wins even over a subsequent exact approval.
    await s.runs.interrupt(projectId, taskId);
    const turns = active.timeline.state.turns.length;
    await incidents.decisions.answer(
      projectId,
      decisionId,
      { kind: 'approval', choice: 'allow_once' },
      taskId,
    );
    assert.equal(active.timeline.state.turns.length, turns);
    assert.equal(execution.read().enabled, false);
    assert.equal(await checkIncident(engine, incidents.store.get(projectId, row.id)), false);
    proof.confirmation = {
      incident: row.id,
      decisionId,
      oneQuestion: true,
      stopPreserved: true,
      waitingReleased: true,
    };

    // Real repair under delegated policy. A renewed intent must replace the old subscription.
    execution.start();
    const current = await incidents.report(
      active,
      `Readiness remains unavailable: ${url}`,
      details,
      'controller',
    );
    setPolicy('delegated', resource.id);
    const before = active.timeline.state.turns.length;
    process.send?.({ stage: 'delegated-repair-through-resource-dispatcher' });
    await incidents.reconcile(projectId, current.id);
    const resolved = incidents.store.get(projectId, current.id);
    assert.equal(resolved.state, 'resolved');
    assert.equal(resolved.protocol!.attempts, 1);
    const action = await incidentAction(engine, resolved);
    assert(action);
    assert.equal(incidents.policy.approval(action)?.author, 'coordinator');
    assert.equal(
      s.db.coordination.getOperation(projectId, resolved.protocol!.operationId!)?.state,
      'succeeded',
    );
    // A resumed native turn uses the existing read-only audit task and preserved owner restrictions.
    const result = await finishedTask(s, projectId, taskId, before);
    await s.runs.interrupt(projectId, taskId);
    assert.equal(result.timeline?.turns.at(-1)?.outcome, 'done');
    proof.recovery = {
      incident: resolved.id,
      operation: resolved.protocol!.operationId,
      action: remedyKey(action),
      attempts: resolved.protocol!.attempts,
      resumedNativeSession: active.run.nativeSessionId,
      delegatedAuthor: incidents.policy.approval(action)?.author,
      turn: result.timeline?.turns.at(-1)?.id,
    };
    // Start a real review consumer before the worker becomes idle; review owns its separate lease.
    await s.runs.openExternal(projectId, taskId, url, async (address) => {
      window = new BrowserWindow({ show: false, width: 1280, height: 800 });
      await window.loadURL(address);
    });
    assert(window);
    const rendered = await window.webContents.executeJavaScript(
      '({ title: document.title, width: document.body.getBoundingClientRect().width, animations: document.getAnimations().length })',
    );
    assert(rendered.width > 0 && rendered.animations > 0);
    await writeFile(
      join(directory, 'cat-pilot.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
    assert(s.resources.holdings(projectId, `review:${taskId}`).length);
    requireReleased(s, projectId, `task:${taskId}`);
    proof.review = rendered;
    await eventually(
      () => engine.queue.state().running,
      (running) => !running.includes(`${projectId}\n${taskId}`),
      'task slot released',
    );
    assert.equal(
      await s.projects.get(projectId).git.head('HEAD', active.run.worktree),
      initialHead,
    );
    proof.headUnchanged = initialHead;
  } finally {
    window?.destroy();
    await s.runs.interrupt(projectId, taskId);
    await engine.reviews.stop(projectId, taskId);
    await engine.environments.stop(task);
    incidents.policy.save(projectId, policy, incidents.policy.read(projectId).revision);
  }
}
