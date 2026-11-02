import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { indexTasks, startBlocker } from '@skaro/core';
import type { RouteSnapshot } from '@skaro/timeline';
import type { Services } from '../app-services';
import { criteriaRevision } from '../completion-store';
import { TaskExecution } from '../task-execution';
import { parseBuiltinTaskStart } from '../builtin-task-start';
import { builtinRunSettingsKey } from '../builtin-run-settings';
import { liveBudgetLedger } from '../credentials/live-budget-ledger';
import { configuredPlanHistory } from './configured-plan-history';
import { readLocalPacket } from './local-packet';
import { planPayloadHash } from './model-plan-request';
import { actualWorkflowSource } from './task-workflow-review';
import { requireTaskWorkflowBudget, type TaskWorkflowBudget } from './task-workflow-budget';
import { requireConfiguredPlanPrice } from './configured-plan-budget';

export const TASK_WORKFLOW_HASH =
  '600af359e54afa9328a70a418205f04784220a016778f298bb1bbcc3bc969cb1';

export interface TaskWorkflowPacket {
  project: { id: string; root: string; name: string };
  predecessorRunId: string;
  wireComposition: {
    route: RouteSnapshot;
    tasks: { id: string; criteriaRevision: string }[];
    sources: { path: string; text: string }[];
  };
  budgetProposal: TaskWorkflowBudget;
  localGuards: {
    sourceRevisions: { path: string; sha256: string }[];
    checkerRevisions: { path: string; sha256: string }[];
  };
}

/** This fixed owner review cannot be replaced with a caller-selected packet/hash. */
export async function readTaskWorkflowPacket(data: string, path: string, hash: string) {
  assert.equal(hash, TASK_WORKFLOW_HASH);
  const packet = (await readLocalPacket(data, path)) as TaskWorkflowPacket;
  assert.equal(planPayloadHash(packet), TASK_WORKFLOW_HASH);
  requireTaskWorkflowBudget(packet.budgetProposal, packet.budgetProposal.baseline);
  return packet;
}

/** Initial-state inspection only: no native host, credentials, task input or permission changes. */
export async function verifyTaskWorkflowPacket(
  services: Services,
  data: string,
  packet: TaskWorkflowPacket,
) {
  assert.equal(planPayloadHash(packet), TASK_WORKFLOW_HASH);
  const projectId = packet.project.id;
  assert.equal(projectId, '78bc2cd3-981b-40ed-a395-c6c6bc7da51b');
  assert.equal(services.db.shell.projectScope, projectId);
  const context = services.projects.get(projectId);
  assert.equal(await realpath(context.root), packet.project.root);
  for (const expected of packet.wireComposition.sources)
    assert.deepEqual(await actualWorkflowSource(context.root, expected.path), expected);
  for (const checker of packet.localGuards.checkerRevisions)
    assert.equal(
      createHash('sha256')
        .update(await readFile(checker.path))
        .digest('hex'),
      checker.sha256,
    );
  const artifacts = await context.load();
  for (const expected of packet.wireComposition.tasks) {
    const task = artifacts.tasks.find((item) => item.id === expected.id);
    assert(task && task.status === 'todo');
    assert.equal(criteriaRevision(task), expected.criteriaRevision);
    assert.equal(
      startBlocker(task, indexTasks(artifacts.tasks)),
      task.id === 'T-006' ? undefined : 'blocked',
    );
  }
  const run = services.db.listRuns(projectId, 'T-006')[0]!;
  assert(run && run.id === packet.predecessorRunId && run.agent === 'skaro');
  assert.equal(run.nativeSessionId, undefined);
  assert.equal(run.retiredAt, undefined);
  assert.equal(run.endedAt, undefined);
  assert.equal(run.worktree, undefined);
  assert.equal(new TaskExecution(services.db, run.id).read().enabled, false);
  assert.equal(services.db.listRuns(projectId, 'T-008').length, 0);
  const selected = parseBuiltinTaskStart(
    services.db.getSetting(builtinRunSettingsKey(run.id), null),
  );
  assert.equal(selected.model, packet.wireComposition.route.routeId);
  assert.equal(selected.permissionMode, 'ask');
  assert.equal(selected.isolation, 'in-place');
  const route = packet.wireComposition.route;
  assert.equal(route.connectionId, 'openrouter-owner');
  assert.equal(route.modelId, 'openai/gpt-4.1-nano');
  const catalog = await services.modelCatalog.read(route.connectionId, route.connectionRevision);
  assert.deepEqual(services.modelConfiguration.snapshot(route.routeId, catalog.models), route);
  const model = catalog.models.find((item) => item.id === route.modelId);
  assert(model);
  requireConfiguredPlanPrice(model.pricing);
  const ledger = join(data, 'verification/openrouter-ba4');
  const budget = await liveBudgetLedger(ledger);
  requireTaskWorkflowBudget(packet.budgetProposal, budget);
  return {
    project: 'Cat-pilot',
    runId: run.id,
    payloadHash: TASK_WORKFLOW_HASH,
    sourceFiles: packet.wireComposition.sources.length,
    checkerFiles: packet.localGuards.checkerRevisions.length,
    settings: selected,
    budget,
    priorJournals: await configuredPlanHistory(ledger, ''),
    implementationBlockedByPlanFirst: selected.planFirst,
    modelRequests: 0,
    credentialBytesRead: false,
    executionAuthorized: false,
  };
}
