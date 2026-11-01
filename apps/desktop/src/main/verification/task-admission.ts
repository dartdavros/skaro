import assert from 'node:assert/strict';
import type { Services } from '../app-services';
import { AdmissionStore } from '../native/admission-state';
import { c4ReviewKey } from '../c4-review';

/** Actual task controller refuses missing/mismatched runs; never fabricate an ActiveRun. */
export async function verifyTaskAdmission(services: Services) {
  const projects = services.db.shell
    .list()
    .filter((project) => project.name.toLowerCase() === 'cat-pilot');
  assert.equal(projects.length, 1);
  const context = services.projects.get(projects[0]!.id);
  const task = await context.store.readTask('T-008');
  const before = JSON.stringify(task);
  const reviewKey = c4ReviewKey(context.id, task.id);
  const review = structuredClone(services.db.getSetting(reviewKey, null));
  const scope = {
    kind: 'task' as const,
    projectId: context.id,
    taskId: task.id,
    runId: 'task-admission-no-active-run',
  };
  const store = new AdmissionStore(services.db, `task:${context.id}:${task.id}:${scope.runId}`);
  const stored = store.read();
  const runs = services.db.listRuns(context.id, task.id);
  await assert.rejects(
    services.runs.builtinAdmission(scope, 'task-admission', new AbortController().signal),
    /No matching active builtin/,
  );
  for (const invalid of [
    { ...scope, runId: undefined },
    { ...scope, taskId: undefined },
    { ...scope, kind: 'project_chat' as const },
    { ...scope, importId: 'unbound-import' },
  ])
    await assert.rejects(
      services.runs.builtinAdmission(invalid, 'task-admission', new AbortController().signal),
      /exact task\/run/,
    );
  assert.deepEqual(store.read(), stored);
  assert.deepEqual(services.db.listRuns(context.id, task.id), runs);
  assert.equal(JSON.stringify(await context.store.readTask(task.id)), before);
  assert.deepEqual(services.db.getSetting(reviewKey, null), review);
  return {
    project: 'Cat-pilot',
    taskId: task.id,
    missingRunRejectedBeforeLease: true,
    exactScopeRequired: true,
    noTaskRunCreated: true,
    admissionUnchanged: true,
    taskAndC4Unchanged: true,
    modelRequests: 0,
  };
}
