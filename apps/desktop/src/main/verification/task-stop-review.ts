import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { indexTasks, startBlocker } from '@skaro/core';
import type { Services } from '../app-services';
import { taskInstructions } from '../prompt-task';
import { taskSections } from '../task-body';
import { c4ReviewKey } from '../c4-review';
import { liveBudgetLedger } from '../credentials/live-budget-ledger';
import { requireConfiguredPlanPrice } from './configured-plan-budget';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const TASK_STOP_MESSAGES = [
  'Это проверка lifecycle Skaro, а не реализация T-006. Не изменяй файлы, не выполняй команды, не используй инструменты и не сдавай задачу. Напиши 40 строк с номерами и словами «проверка остановки». Skaro прервёт этот ход.',
  'Продолжение проверки lifecycle после Stop и нового admission. Не реализуй T-006, не изменяй файлы, не выполняй команды и не сдавай задачу. Ответь только «Продолжение принято».',
] as const;

/** Review only: real task/prompt/configuration, no ActiveRun, native process, key or model POST. */
export async function prepareTaskStopReview(services: Services, directory: string, data: string) {
  const projectId = services.db.shell.projectScope;
  assert.equal(projectId, '78bc2cd3-981b-40ed-a395-c6c6bc7da51b');
  const context = services.projects.get(projectId);
  const task = await context.store.readTask('T-006');
  assert.equal(task.status, 'todo');
  assert.equal(task.archived, false);
  assert.equal(services.db.listRuns(projectId, task.id).length, 0, 'Task already has a run');
  assert.equal(services.db.getSetting(`startup.${projectId}.${task.id}`, null), null);
  const reviewKey = c4ReviewKey(projectId, task.id);
  const review = services.db.getSetting(reviewKey, null);
  const artifacts = await context.load();
  assert.equal(startBlocker(task, indexTasks(artifacts.tasks)), undefined);
  const dependencies = task.dependsOn.map((id) => {
    const dependency = artifacts.tasks.find((entry) => entry.id === id);
    assert(dependency && dependency.status === 'done');
    return { id, status: dependency.status, path: dependency.path };
  });
  const configuration = services.modelConfiguration.read();
  const route = configuration.routes.find(
    (entry) => entry.connectionId === 'openrouter-owner' && entry.modelId === 'openai/gpt-4.1-nano',
  );
  assert(route);
  const connection = configuration.connections.find((entry) => entry.id === route.connectionId)!;
  const catalog = await services.modelCatalog.read(connection.id, connection.revision);
  const snapshot = services.modelConfiguration.snapshot(route.id, catalog.models);
  assert.equal(snapshot.endpoint, 'https://openrouter.ai/api/v1');
  const model = catalog.models.find((entry) => entry.id === snapshot.modelId)!;
  requireConfiguredPlanPrice(model.pricing);
  const instructions = taskInstructions({
    task,
    artifacts,
    root: context.root,
    cwd: context.root,
    locale: 'ru',
    managedEnvironment: false,
  });
  const documents: { path: string; text: string }[] = [];
  try {
    documents.push({
      path: 'AGENTS.md',
      text: await readFile(join(context.root, 'AGENTS.md'), 'utf8'),
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const baseline = await liveBudgetLedger(join(data, 'verification/openrouter-ba4'));
  const packet = {
    schema: 1,
    kind: 'cat-pilot-task-stop-review',
    attemptId: randomUUID(),
    executionAuthorized: false,
    project: { id: projectId, name: 'Cat-pilot', root: context.root },
    task: {
      id: task.id,
      title: task.title,
      path: task.path,
      status: task.status,
      dependencies,
      criteria: taskSections(task.body).criteria,
    },
    wireComposition: {
      route: snapshot,
      instructions,
      contextDocuments: documents,
      ownerMessages: TASK_STOP_MESSAGES,
      tools: [],
      continuation:
        'Only model replies and nonsecret run/session/admission IDs and journal references from this new session; no prior task histories or other source files',
    },
    launch: { model: route.id, permissionMode: 'ask', planFirst: true, isolation: 'in-place' },
    prohibitions: [
      'source edits',
      'command execution',
      'tool execution',
      'submit_result',
      'merge',
      'T-008 launch',
      'automatic task completion',
    ],
    lifecycle: [
      'create real T-006 run',
      'interrupt first model turn',
      'confirm old process exit and revoked admission',
      'resume same run/journal with new process admission',
      'deliver second owner message',
      'stop and return task to todo',
    ],
    retainedLocalEffects: [
      'real run and primary journal',
      'owner messages and model replies',
      'admission/process audit records',
    ],
    budgetProposal: {
      baseline,
      additionalRequests: 4,
      requestCeiling: baseline.requests + 4,
      ceilingNanoUsd: 950_000_000,
      totalOwnerLimitUsd: 1,
      unknownHoldsRetained: true,
    },
    localPreconditions: {
      taskSha256: hash(JSON.stringify(task)),
      c4Review: review,
      configurationRevision: configuration.revision,
      advertisedPricing: model.pricing,
    },
    pending: [
      'runnable lifecycle driver with request envelope/budget gates',
      'owner approval of this data composition and four additional requests',
    ],
  };
  // Hashes and C4 state are local guards, not part of the permitted wire composition.
  const path = join(directory, 'task-stop-review.json');
  await writeFile(path, JSON.stringify(packet, null, 2), { flag: 'wx', mode: 0o600 });
  assert.deepEqual(await context.store.readTask(task.id), task);
  assert.deepEqual(services.db.getSetting(reviewKey, null), review);
  assert.deepEqual(services.modelConfiguration.read(), configuration);
  assert.equal(services.db.listRuns(projectId, task.id).length, 0);
  return {
    path,
    sha256: hash(JSON.stringify(packet)),
    project: 'Cat-pilot',
    taskId: task.id,
    criteria: packet.task.criteria.length,
    dependencies,
    budgetProposal: packet.budgetProposal,
    projectSourceFilesInWire: documents.length,
    credentialBytesRead: false,
    modelRequests: 0,
    taskRunCreated: false,
    taskC4ConfigurationUnchanged: true,
    executionAuthorized: false,
    pending: packet.pending,
  };
}
