import assert from 'node:assert/strict';
import { app, type Session } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readRuntimeJournal } from '@skaro/agent-runtime';
import { withoutSkaroNote, type ChatResponse } from '@skaro/timeline';
import type { Services } from '../app-services';
import { c4ReviewKey } from '../c4-review';
import { TaskExecution } from '../task-execution';
import type { taskStopModels } from './task-stop-models';
import type { TaskStopReview } from './task-stop-review';
import { registerTaskBudgetJournal } from '../credentials/task-budget-journals';
import { requireTaskStopCurrent } from './task-stop-packet';
import {
  waitTaskStop,
  taskAdmissionStore,
  requireTaskProcessExit,
  observeTaskJournal,
} from './task-stop-observation';

/** Invoke only after explicit owner approval of this packet and its four-request extension. */
export async function verifyTaskStopLive(
  services: Services,
  data: string,
  directory: string,
  reviewed: TaskStopReview,
  hash: string,
  models: ReturnType<typeof taskStopModels>,
) {
  await requireTaskStopCurrent(services, data, reviewed);
  const projectId = reviewed.project.id,
    taskId = 'T-006';
  const context = services.projects.get(projectId);
  const beforeTask = await context.store.readTask(taskId);
  const beforeC4 = services.db.getSetting(c4ReviewKey(projectId, taskId), null);
  const beforeConfiguration = services.modelConfiguration.read();
  const commandPrefix = `task-stop-${reviewed.attemptId}`;
  const networks: Session[] = [];
  let posts = 0,
    stage = 'launch',
    passed = false,
    cleanupConfirmed = false;
  const stages: string[] = [];
  const mark = (next: string) => {
    stage = next;
    stages.push(next);
    process.send?.({ type: 'stage', stage: `task-stop:${next}` });
  };
  const observe = (network: Session) => {
    networks.push(network);
    network.webRequest.onBeforeRequest(
      { urls: ['https://openrouter.ai/api/v1/chat/completions'] },
      (details, callback) => {
        if (details.method === 'POST') posts++;
        callback({ cancel: false });
      },
    );
  };
  app.on('session-created', observe);
  let result: unknown;
  try {
    await services.runs.launchBuiltin({
      projectId,
      taskId,
      settings: reviewed.launch,
      input: {
        text: reviewed.wireComposition.ownerMessages[0],
        commandId: `${commandPrefix}-first`,
      },
      signal: new AbortController().signal,
    });
    const run = await waitTaskStop('real run', () => services.db.listRuns(projectId, taskId)[0]);
    assert.equal(run.agent, 'skaro');
    assert.equal(run.worktree, undefined);
    const store = taskAdmissionStore(services, projectId, run.id);
    const first = await waitTaskStop('first active owner', () => {
      const state = store.read();
      return state?.status === 'active' && state.owner ? state : undefined;
    });
    mark('first-provider-request');
    await waitTaskStop('first provider POST', () => (posts > 0 ? true : undefined));
    const firstInput = models.generations[0]!;
    const beforeStop = await waitTaskStop('stable first journal', () =>
      observeTaskJournal(firstInput.journalPath, firstInput.sessionId),
    );
    const firstCompletedBeforeStop = beforeStop.records.some((record) =>
      record.id.startsWith('cmd:owner-'),
    );
    mark('stop-first');
    await services.runs.interrupt(projectId, taskId);
    const firstExit = await requireTaskProcessExit(store, first.admission.id);
    await assert.rejects(
      firstInput.admissions.requireActive(first.admission, new AbortController().signal),
    );
    const stopped = await readRuntimeJournal(firstInput.journalPath, firstInput.sessionId);
    const stoppedHead = stopped.records.at(-1)!;
    const firstPostCount = posts;
    assert.equal(firstPostCount, 1, 'Unexpected automatic first-turn continuation');
    mark('resume-second');
    await services.runs.send(projectId, taskId, {
      text: reviewed.wireComposition.ownerMessages[1],
      commandId: `${commandPrefix}-second`,
    });
    const second = await waitTaskStop('new active admission', () => {
      const state = store.read();
      return state?.status === 'active' && state.owner && state.admission.id !== first.admission.id
        ? state
        : undefined;
    });
    assert(second.admission.generation > first.admission.generation);
    assert.equal(second.admission.sessionId, first.admission.sessionId);
    assert.notDeepEqual(second.owner, first.owner);
    const secondInput = models.generations[1]!;
    const resumed = await readRuntimeJournal(secondInput.journalPath, secondInput.sessionId);
    assert.equal(resumed.records[stoppedHead.sequence - 1]?.hash, stoppedHead.hash);
    const answer = await waitTaskStop('second real model terminal', async () => {
      const journal = await observeTaskJournal(secondInput.journalPath, secondInput.sessionId);
      const ack = journal?.records.find((record) => record.id === `cmd:${commandPrefix}-second`);
      const modelId = (ack?.result.value as { modelTurnId?: string } | undefined)?.modelTurnId;
      return modelId
        ? journal?.records.find((record) => record.id === `cmd:${modelId}`)
        : undefined;
    });
    assert.equal(
      answer.result.error,
      undefined,
      'Second model turn failed; do not retry automatically',
    );
    const response = answer.result.value as ChatResponse;
    assert.equal(response.finishReason, 'stop');
    assert.equal(response.message.content?.trim(), 'Продолжение принято');
    assert(!response.message.tool_calls?.length);
    const sourceId = await registerTaskBudgetJournal({
      db: services.db,
      ledger: join(data, 'verification/openrouter-ba4'),
      scope: secondInput.scope,
      admission: second.admission,
      admissions: secondInput.admissions,
      journal: secondInput.journalPath,
      signal: secondInput.signal,
    });
    const budget = await requireTaskStopCurrent(services, data, reviewed, {
      runId: run.id,
      sourceId,
    });
    mark('stop-second-and-return-todo');
    await services.runs.cancel(projectId, taskId);
    const secondExit = await requireTaskProcessExit(store, second.admission.id);
    await assert.rejects(
      secondInput.admissions.requireActive(second.admission, new AbortController().signal),
    );
    assert.equal(models.generations.length, 2);
    assert.equal(posts, 2);
    assert.equal(models.counts().dispatchPermits, posts);
    const final = await readRuntimeJournal(secondInput.journalPath, secondInput.sessionId);
    const inputs = final.records
      .flatMap((record) => record.facts)
      .filter((fact) => fact.type === 'input');
    assert.deepEqual(
      inputs.map((fact) => withoutSkaroNote(fact.input.text)),
      reviewed.wireComposition.ownerMessages,
    );
    assert.equal(services.db.listRuns(projectId, taskId).length, 1);
    assert.equal(services.db.listRuns(projectId, taskId)[0]?.id, run.id);
    assert.equal(new TaskExecution(services.db, run.id).read().enabled, false);
    result = {
      project: 'Cat-pilot',
      taskId,
      runId: run.id,
      payloadHash: hash,
      primaryJournal: secondInput.journalPath,
      sessionId: secondInput.sessionId,
      firstExit,
      secondExit,
      firstCompletedBeforeStop,
      sameRunAndJournal: true,
      twoExactOwnerInputs: true,
      toolsVended: 0,
      modelPostAttempts: posts,
      budget,
      ...models.counts(),
    };
    passed = true;
  } finally {
    mark('cleanup');
    app.removeListener('session-created', observe);
    for (const network of networks) network.webRequest.onBeforeRequest(null);
    try {
      await services.runs.cancel(projectId, taskId);
      assert.deepEqual(await context.store.readTask(taskId), beforeTask);
      assert.deepEqual(services.db.getSetting(c4ReviewKey(projectId, taskId), null), beforeC4);
      assert.deepEqual(services.modelConfiguration.read(), beforeConfiguration);
      const latest = services.db.listRuns(projectId, taskId)[0];
      if (latest) {
        const last = taskAdmissionStore(services, projectId, latest.id).read();
        if (last)
          await requireTaskProcessExit(
            taskAdmissionStore(services, projectId, latest.id),
            last.admission.id,
          );
      }
      cleanupConfirmed = true;
    } finally {
      await writeFile(
        join(directory, 'task-stop-attempt.json'),
        JSON.stringify(
          {
            passed: passed && cleanupConfirmed,
            cleanupConfirmed,
            stage,
            stages,
            payloadHash: hash,
            modelPostAttempts: posts,
            ...models.counts(),
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
