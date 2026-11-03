import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readRuntimeJournal } from '@skaro/agent-runtime';
import type { ChatResponse } from '@skaro/timeline';
import type { Services } from '../app-services';
import { serializeTaskMutation } from '../project-task-mutations';
import { updateSubject } from '../task-subject';
import { registerTaskBudgetJournal } from '../credentials/task-budget-journals';
import { taskBudgetSourceId } from '../credentials/task-budget-source';
import { TaskExecution } from '../task-execution';
import type { TaskStopReview } from './task-stop-review';
import type { taskStopModels } from './task-stop-models';
import { verifyTaskStopReplay } from './task-stop-replay';
import { readLocalPacket } from './local-packet';
import { taskStopMainRestartInput, requireTaskStopInputs } from './task-stop-input';
import {
  taskAdmissionStore,
  requireTaskProcessExit,
  waitTaskStop,
  observeTaskJournal,
} from './task-stop-observation';
import { requireTaskStopCurrent } from './task-stop-packet';
import { observeModelPosts } from './model-post-observer';

/** One final reviewed message after real main exit. No replay/retry of any older provider intent. */
export async function verifyTaskStopMainRestart(
  services: Services,
  data: string,
  directory: string,
  reviewed: TaskStopReview,
  hash: string,
  proofPath: string,
  models: ReturnType<typeof taskStopModels>,
) {
  const checked = await verifyTaskStopReplay(services, data, reviewed, hash, proofPath);
  assert.equal(checked.budget.requests, 88, 'Exactly one reviewed request must remain');
  const previous = (await readLocalPacket(data, proofPath)) as { proof: Record<string, unknown> };
  assert.equal(previous.proof.mainRestart, undefined);
  assert.equal(models.generations.length, 0);
  const projectId = reviewed.project.id,
    taskId = 'T-006',
    runId = checked.runId;
  const context = services.projects.get(projectId);
  const beforeTask = await context.store.readTask(taskId);
  const beforeConfiguration = services.modelConfiguration.read();
  const store = taskAdmissionStore(services, projectId, runId);
  const previousExit = store.read()!;
  const current = {
    runId,
    sourceId: taskBudgetSourceId(runId, checked.sessionId),
    status: 'todo' as const,
  };
  const message = taskStopMainRestartInput(reviewed);
  let posts = 0,
    passed = false,
    cleanupConfirmed = false;
  let result: Record<string, unknown> | undefined;
  const closeObservation = observeModelPosts(() => posts++);
  try {
    process.send?.({ type: 'stage', stage: 'task-stop:main-restart-send' });
    await serializeTaskMutation(context, async () => {
      await requireTaskStopCurrent(services, data, reviewed, current);
      assert.deepEqual(store.read(), previousExit);
      await updateSubject(context, taskId, { status: 'in_progress' });
      context.invalidate();
    });
    services.runs.projectChanged(projectId);
    await services.runs.send(projectId, taskId, message);
    const active = await waitTaskStop('new main native admission', () => {
      const state = store.read();
      return state?.status === 'active' && state.owner ? state : undefined;
    });
    assert(active.admission.generation > previousExit.admission.generation);
    assert.notEqual(active.host.pid, previousExit.host.pid);
    assert.equal(active.admission.sessionId, checked.sessionId);
    const generation = models.generations[0]!;
    const answer = await waitTaskStop('model reply in new main', async () => {
      const journal = await observeTaskJournal(generation.journalPath, generation.sessionId);
      const ack = journal?.records.find((record) => record.id === `cmd:${message.commandId}`);
      const id = (ack?.result.value as { modelTurnId?: string } | undefined)?.modelTurnId;
      return id ? journal?.records.find((record) => record.id === `cmd:${id}`) : undefined;
    });
    assert.equal(
      answer.result.error,
      undefined,
      'Main restart turn failed; automatic retry forbidden',
    );
    const response = answer.result.value as ChatResponse;
    assert.equal(response.finishReason, 'stop');
    assert.equal(response.message.content?.trim(), 'Продолжение принято');
    assert(!response.message.tool_calls?.length);
    await registerTaskBudgetJournal({
      db: services.db,
      ledger: join(data, 'verification/openrouter-ba4'),
      scope: generation.scope,
      admission: active.admission,
      admissions: generation.admissions,
      journal: generation.journalPath,
      signal: generation.signal,
    });
    const budget = await requireTaskStopCurrent(services, data, reviewed, {
      ...current,
      status: 'in_progress',
    });
    assert.equal(budget.requests, 89);
    process.send?.({ type: 'stage', stage: 'task-stop:main-restart-stop' });
    await services.runs.cancel(projectId, taskId);
    const exit = await requireTaskProcessExit(store, active.admission.id);
    await assert.rejects(
      generation.admissions.requireActive(active.admission, new AbortController().signal),
    );
    const final = await readRuntimeJournal(generation.journalPath, generation.sessionId);
    const inputs = final.records
      .flatMap((record) => record.facts)
      .filter((fact) => fact.type === 'input');
    requireTaskStopInputs(reviewed, inputs);
    assert.equal(inputs.length, 4);
    assert.equal(models.generations.length, 1);
    assert.equal(posts, 1);
    assert.deepEqual(models.counts(), { quotes: 1, dispatchPermits: 1 });
    assert.equal(new TaskExecution(services.db, runId).read().enabled, false);
    result = {
      ...previous.proof,
      budget,
      mainRestart: {
        exit,
        previousMainExited: true,
        sameRunAndPrimarySession: true,
        modelPostAttempts: posts,
        exactReviewedOwnerMessage: true,
        toolsVended: 0,
        ...models.counts(),
      },
    };
    passed = true;
  } finally {
    closeObservation();
    try {
      await services.runs.cancel(projectId, taskId);
      assert.deepEqual(await context.store.readTask(taskId), beforeTask);
      assert.deepEqual(services.modelConfiguration.read(), beforeConfiguration);
      const last = store.read();
      if (last) await requireTaskProcessExit(store, last.admission.id, false);
      await requireTaskStopCurrent(services, data, reviewed, current);
      cleanupConfirmed = true;
    } finally {
      await writeFile(
        join(directory, 'task-main-restart-attempt.json'),
        JSON.stringify(
          {
            passed: passed && cleanupConfirmed,
            cleanupConfirmed,
            payloadHash: hash,
            modelPostAttempts: posts,
            result,
          },
          null,
          2,
        ),
        { flag: 'wx', mode: 0o600 },
      );
    }
  }
  return result;
}
