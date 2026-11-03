import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { Services } from '../app-services';
import { readLocalPacket } from './local-packet';
import { planPayloadHash } from './model-plan-request';
import { taskSections } from '../task-body';
import { TaskExecution } from '../task-execution';
import { liveBudgetLedger } from '../credentials/live-budget-ledger';
import { configuredPlanHistory } from './configured-plan-history';
import { c4ReviewKey } from '../c4-review';
import type { TaskStopReview } from './task-stop-review';
import { prepareBuiltinTaskBrowser } from '../builtin-task-browser';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import { writeFile } from 'node:fs/promises';
import { prepareTaskWorkflowReview } from './task-workflow-review';
import { readRuntimeJournal, unresolvedVerificationEffects } from '@skaro/agent-runtime';
import { builtinSessionDirectory } from '../builtin-session-directory';

/** Real current and stale predecessor scopes. Deliberately unsupported claims must not tick criteria. */
export async function verifyTaskCompletionPreflight(
  services: Services,
  data: string,
  reviewed: TaskStopReview,
  proofPath: string,
  directory: string,
) {
  const handoff = (await readLocalPacket(data, proofPath)) as {
    proof: { currentRunId: string; originalRunId: string; transactionalHandoffOnly: boolean };
  };
  assert.equal(handoff.proof.transactionalHandoffOnly, true);
  const projectId = reviewed.project.id,
    taskId = 'T-006';
  assert.equal(services.db.shell.projectScope, projectId);
  const context = services.projects.get(projectId);
  const task = await context.store.readTask(taskId);
  assert.equal(task.status, 'todo');
  assert.equal(planPayloadHash(task), reviewed.localPreconditions.taskSha256);
  const runs = services.db.listRuns(projectId, taskId);
  const current = runs[0]!;
  assert.equal(current.id, handoff.proof.currentRunId);
  assert.equal(current.agent, 'skaro');
  assert.equal(current.nativeSessionId, undefined);
  const original = services.db.getRun(handoff.proof.originalRunId)!;
  assert(original.nativeSessionId);
  const previousPrimary = await readRuntimeJournal(
    join(
      builtinSessionDirectory(data, 'tasks', original.id, original.nativeSessionId),
      'journal.jsonl',
    ),
    original.nativeSessionId,
  );
  assert(
    Object.values(previousPrimary.state.effects).some(
      (effect) => effect.state === 'unknown' && effect.name === 'model:chat',
    ),
  );
  assert.deepEqual(unresolvedVerificationEffects(previousPrimary), []);
  const c4Key = c4ReviewKey(projectId, taskId),
    c4 = services.db.getSetting(c4Key, null);
  const configuration = services.modelConfiguration.read();
  const execution = new TaskExecution(services.db, current.id).read();
  const ledger = join(data, 'verification/openrouter-ba4');
  const before = {
    budget: await liveBudgetLedger(ledger),
    history: await configuredPlanHistory(ledger, ''),
  };
  const args = {
    commitMessage: 'test: unsupported completion preflight must be rejected',
    criteria: taskSections(task.body).criteria.map((_, i) => ({
      number: i + 1,
      met: true,
      evidence: 'No evidence: this unsupported claim must fail',
    })),
    summary:
      'Negative preflight: no implementation or evidence has been authorized; these unsupported claims must be refused.',
  };
  const response = await services.runs.submitResult(args, {
    kind: 'task',
    projectId,
    taskId,
    runId: current.id,
  });
  assert.equal(response.isError, true);
  assert.match(response.text, /current active native admission/);
  const stale = runs.find((run) => run.agent !== 'skaro');
  assert(stale);
  const old = await services.runs.submitResult(args, {
    kind: 'task',
    projectId,
    taskId,
    runId: stale.id,
  });
  assert.equal(old.isError, true);
  assert.match(old.text, /no longer the current run/);
  const review = await services.runs.builtinReview(projectId, taskId);
  let browser: Awaited<ReturnType<typeof prepareBuiltinTaskBrowser>> | undefined;
  let processes: { pid: number; birth: string }[];
  try {
    browser = await prepareBuiltinTaskBrowser(
      review,
      [
        'browser_navigate',
        'browser_evaluate',
        'browser_take_screenshot',
        'browser_console_messages',
      ].map((name) => ({ name, readOnly: false })),
      true,
    );
    assert.equal(browser.extensions.tools.length, 4);
    await assert.rejects(
      browser.extensions.tools[0]!.invoke('pre-admission-denial', {}, review.signal),
      /not active/,
    );
    processes = services.db.getSetting(`run.${current.id}.processes`, []);
    assert(processes.length > 0);
    const catalogPath = join(directory, 'task-workflow-review-input.json');
    await writeFile(
      catalogPath,
      JSON.stringify(
        {
          kind: 'cat-pilot-task-workflow-review-input',
          executionAuthorized: false,
          scope: review.scope,
          run: review.run,
          settings: reviewed.launch,
          instructions: review.options.instructions,
          browser: browser.extensions.tools.map(({ invoke: _invoke, ...tool }) => tool),
          skaro: services.mcp.describe(review.scope),
          budget: before.budget,
          modelRequests: 0,
        },
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
  } finally {
    await browser?.extensions.close();
    await review.close();
  }
  for (const owner of processes) assert.notEqual(await processBirth(owner.pid), owner.birth);
  assert.deepEqual(await context.store.readTask(taskId), task);
  assert.deepEqual(services.db.listRuns(projectId, taskId), runs);
  assert.deepEqual(services.db.getSetting(c4Key, null), c4);
  assert.deepEqual(services.modelConfiguration.read(), configuration);
  assert.deepEqual(new TaskExecution(services.db, current.id).read(), execution);
  assert.deepEqual(await liveBudgetLedger(ledger), before.budget);
  assert.deepEqual(await configuredPlanHistory(ledger, ''), before.history);
  const workflowReview = await prepareTaskWorkflowReview(services, data, directory, reviewed);
  return {
    project: 'Cat-pilot',
    taskId,
    unsupportedBuiltinClaimsRejected: true,
    staleManagedScopeRejected: true,
    actualBrowserMetadata: true,
    browserCallsDeniedBeforeNativeAdmission: true,
    auxiliaryOwnersExited: processes.length,
    taskCriteriaRunsC4SettingsUnchanged: true,
    budget: before.budget,
    modelRequests: 0,
    nativeAdmissionsCreated: 0,
    unknownBillingRetainedWithConfirmedLaterConversation: true,
    workflowReview,
  };
}
