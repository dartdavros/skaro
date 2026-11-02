import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { indexTasks, startBlocker } from '@skaro/core';
import type { Services } from '../app-services';
import { c4ReviewKey } from '../c4-review';

/** Actual registered task, configuration, catalog and queue; no run or model may be started. */
export async function verifyTaskLaunchPreflight(services: Services) {
  const projectId = services.db.shell.projectScope;
  assert.equal(projectId, '78bc2cd3-981b-40ed-a395-c6c6bc7da51b');
  const context = services.projects.get(projectId);
  const artifacts = await context.store.load();
  const task = artifacts.tasks.find((entry) => entry.id === 'T-008');
  assert(task);
  assert.equal(startBlocker(task, indexTasks(artifacts.tasks)), 'blocked');
  const configuration = services.modelConfiguration.read();
  const route = configuration.routes.find(
    (entry) => entry.connectionId === 'openrouter-owner' && entry.modelId === 'openai/gpt-4.1-nano',
  );
  assert(route);
  const startup = `startup.${projectId}.${task.id}`;
  const review = c4ReviewKey(projectId, task.id);
  const before = {
    task: JSON.stringify(task),
    runs: services.db.listRuns(projectId, task.id),
    startup: services.db.getSetting(startup, null),
    review: services.db.getSetting(review, null),
    slots: services.runs.slots(),
  };
  assert.equal(before.runs.length, 0);
  assert.equal(before.startup, null);
  const request = {
    projectId,
    taskId: task.id,
    settings: {
      model: route.id,
      permissionMode: 'ask' as const,
      planFirst: true,
      isolation: 'worktree' as const,
    },
    input: {
      commandId: randomUUID(),
      text: 'Local launch preflight only. No task execution or model transmission is authorized.',
    },
  };
  const stopped = new AbortController();
  stopped.abort(new Error('Owner cancelled task launch preflight'));
  await assert.rejects(
    services.runs.launchBuiltin({ ...request, signal: stopped.signal }),
    /Owner cancelled/,
  );
  const duringMetadata = new AbortController();
  const admission = services.runs.launchBuiltin({ ...request, signal: duringMetadata.signal });
  duringMetadata.abort(new Error('Owner cancelled task launch preflight'));
  await assert.rejects(admission, /Owner cancelled/);
  await assert.rejects(
    services.runs.launchBuiltin({ ...request, signal: new AbortController().signal }),
    /cannot start: blocked/,
  );
  await assert.rejects(
    services.runs.launchBuiltin({
      ...request,
      settings: { ...request.settings, model: 'unconfigured-preflight-route' },
      signal: new AbortController().signal,
    }),
    /route is unavailable/,
  );
  assert.equal(JSON.stringify(await context.store.readTask(task.id)), before.task);
  assert.deepEqual(services.db.listRuns(projectId, task.id), before.runs);
  assert.deepEqual(services.db.getSetting(startup, null), before.startup);
  assert.deepEqual(services.db.getSetting(review, null), before.review);
  assert.deepEqual(services.runs.slots(), before.slots);
  assert.deepEqual(services.modelConfiguration.read(), configuration);
  return {
    project: 'Cat-pilot',
    projectId,
    taskId: task.id,
    actualConfigurationAndCatalog: true,
    cancelledBeforeQueue: true,
    cancelledDuringMetadata: true,
    actualDependencyBlockerRejected: true,
    unknownRouteRejected: true,
    taskRunStartupC4ConfigurationUnchanged: true,
    modelRequests: 0,
    noTaskRunCreated: true,
  };
}
