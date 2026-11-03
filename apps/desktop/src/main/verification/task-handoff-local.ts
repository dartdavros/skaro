import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Services } from '../app-services';
import type { AgentId, AgentSettings } from '../../shared/ipc';
import { TaskExecution } from '../task-execution';
import { handoffRecord } from '../task-handoff-record';
import { loadTaskHistory } from '../task-history-load';
import { liveBudgetLedger } from '../credentials/live-budget-ledger';
import { configuredPlanHistory } from './configured-plan-history';
import { verifyTaskStopReplay } from './task-stop-replay';
import { readLocalPacket } from './local-packet';
import { taskAdmissionStore, requireTaskProcessExit } from './task-stop-observation';
import type { TaskStopReview } from './task-stop-review';

/** Genuine transactional handoffs on the owner's stopped run; neither target starts a model. */
export async function verifyTaskHandoffLocal(
  services: Services,
  data: string,
  directory: string,
  reviewed: TaskStopReview,
  hash: string,
  proofPath: string,
) {
  const previous = await verifyTaskStopReplay(services, data, reviewed, hash, proofPath);
  const packet = (await readLocalPacket(data, proofPath)) as { proof: { primaryJournal: string } };
  const projectId = reviewed.project.id,
    taskId = 'T-006';
  const context = services.projects.get(projectId);
  const original = services.db.getRun(previous.runId)!;
  const beforeTask = await context.store.readTask(taskId);
  const configuration = services.modelConfiguration.read();
  const ledger = join(data, 'verification/openrouter-ba4');
  const beforeSources = await configuredPlanHistory(ledger, '');
  const primary = await readFile(packet.proof.primaryJournal);
  const originalAdmission = taskAdmissionStore(services, projectId, original.id).read()!;
  await requireTaskProcessExit(
    taskAdmissionStore(services, projectId, original.id),
    originalAdmission.admission.id,
  );
  const execution = new TaskExecution(services.db, original.id).read();
  assert.equal(execution.enabled, false);
  const ready: { agent: AgentId; settings: AgentSettings }[] = [];
  const unavailable: { agent: AgentId; reason: string }[] = [];
  // Readiness/model discovery is the normal installed adapter path, never a substitute target.
  for (const agent of ['codex', 'claude-code'] as const) {
    try {
      await services.agents.requireReady(agent);
      const models = await services.agents.listModels(agent, context.root);
      const model = models.find((entry) => entry.isDefault) ?? models[0];
      assert(model, 'The actual agent has no advertised model');
      ready.push({
        agent,
        settings: {
          agent,
          model: model.id,
          permissionMode: 'ask',
          planFirst: true,
          isolation: 'in-place',
        },
      });
    } catch (error) {
      unavailable.push({
        agent,
        reason: error instanceof Error ? error.message.slice(0, 180) : 'Readiness failed',
      });
    }
  }
  assert(ready.length, 'No real managed target is ready');
  let current = original;
  let stage = 'prepared',
    passed = false;
  const transitions: { from: string; to: string; agent: string }[] = [];
  try {
    for (const target of ready) {
      const before = await loadTaskHistory({ db: services.db, dataDir: data }, current);
      const preferenceKey = `task.${projectId}.${taskId}.agent`;
      const beforePreferences = services.db.getSetting(preferenceKey, null);
      stage = `builtin-to-${target.agent}`;
      process.send?.({ type: 'stage', stage: `task-handoff:${stage}` });
      await services.runs.setSettings(projectId, taskId, target.settings);
      const managed = services.db.listRuns(projectId, taskId)[0]!;
      assert.notEqual(managed.id, current.id);
      assert.equal(managed.agent, target.agent);
      assert.equal(managed.previousRunId, current.id);
      assert.equal(managed.worktree, current.worktree);
      assert.equal(managed.branch, current.branch);
      assert.equal(managed.nativeSessionId, undefined);
      assert(services.db.getRun(current.id)?.endedAt);
      const contextRecord = handoffRecord(managed)!;
      assert(contextRecord.context.includes(`run: ${current.id}`));
      assert.deepEqual(contextRecord.inputs, []);
      const inherited = { ...execution };
      delete inherited.turn;
      assert.deepEqual(new TaskExecution(services.db, managed.id).read(), inherited);
      assert.equal(services.db.getSetting(`startup.${projectId}.${taskId}`, null), null);
      transitions.push({ from: current.id, to: managed.id, agent: target.agent });
      stage = `${target.agent}-to-builtin`;
      process.send?.({ type: 'stage', stage: `task-handoff:${stage}` });
      await services.runs.handoffBuiltin({
        projectId,
        taskId,
        settings: reviewed.launch,
        signal: new AbortController().signal,
      });
      const builtin = services.db.listRuns(projectId, taskId)[0]!;
      assert.equal(builtin.agent, 'skaro');
      assert.equal(builtin.previousRunId, managed.id);
      assert.equal(builtin.worktree, original.worktree);
      assert.equal(builtin.branch, original.branch);
      assert.equal(builtin.nativeSessionId, undefined);
      assert.deepEqual(services.db.getSetting(`builtin.run.${builtin.id}.settings`, null), {
        agent: 'skaro',
        ...reviewed.launch,
      });
      assert.deepEqual(new TaskExecution(services.db, builtin.id).read(), inherited);
      assert.equal(taskAdmissionStore(services, projectId, builtin.id).read(), undefined);
      assert.deepEqual(handoffRecord(builtin)?.inputs, []);
      assert.equal(services.db.getSetting(`${preferenceKey}.handoff`, null), null);
      const after = await loadTaskHistory({ db: services.db, dataDir: data }, builtin);
      for (const item of before.timeline.state.items) {
        const found = after.timeline.state.items.filter((entry) => entry.id === item.id);
        assert.equal(found.length, 1);
        if (item.kind === 'message') assert.deepEqual(found[0], item);
      }
      assert.deepEqual(await context.store.readTask(taskId), beforeTask);
      assert.deepEqual(services.modelConfiguration.read(), configuration);
      transitions.push({ from: managed.id, to: builtin.id, agent: 'skaro' });
      // The selected run is explicit. Retain the owner's prior managed preference on return.
      const handedPreferences = services.db.getSetting(preferenceKey, null);
      assert(
        services.db.settings.compareAndSet(preferenceKey, handedPreferences, beforePreferences),
      );
      current = builtin;
    }
    assert.deepEqual(await readFile(packet.proof.primaryJournal), primary);
    assert.deepEqual(await configuredPlanHistory(ledger, ''), beforeSources);
    assert.deepEqual(await liveBudgetLedger(ledger), previous.budget);
    assert.deepEqual(
      taskAdmissionStore(services, projectId, original.id).read(),
      originalAdmission,
    );
    assert.equal(services.db.listRuns(projectId, taskId).length, 1 + ready.length * 2);
    passed = true;
    return {
      project: 'Cat-pilot',
      taskId,
      originalRunId: original.id,
      currentRunId: current.id,
      transitions,
      unavailable,
      allManagedTargetsReady: !unavailable.length,
      transactionalHandoffOnly: true,
      modelRequests: 0,
      nativeSessionsStarted: 0,
      sameCheckoutAndBranch: true,
      historyRetainedWithoutDuplicateMessages: true,
      executionStopRetained: true,
      priorLeasesRemainRevoked: true,
      taskAndModelConfigurationUnchanged: true,
      budget: previous.budget,
    };
  } finally {
    await writeFile(
      join(directory, 'task-handoff-attempt.json'),
      JSON.stringify(
        {
          passed,
          stage,
          transitions,
          unavailable,
          modelRequests: 0,
          nativeSessionsStarted: 0,
        },
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
  }
}
