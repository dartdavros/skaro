import { app } from 'electron';
import assert from 'node:assert/strict';
import { createServices, type Services } from '../src/main/app-services';
import { catPilotState } from '../src/main/verification/cat-pilot-state';
import { closeBackground } from '../src/main/background/client';
import { TaskExecution } from '../src/main/task-execution';
import type { AppState } from '../src/main/state';
import type { BuiltinTaskStart } from '../src/main/builtin-task-start';

// Real transactional handoff only. The refusal below is a model-admission policy, not a backend.
app.setName('Skaro');
app.setPath('userData', process.env['SKARO_FOLLOW_UP_PROFILE']!);
void app.whenReady().then(async () => {
  let state: AppState | undefined;
  let services: Services | undefined;
  let code = 1;
  let preparations = 0;
  try {
    assert(app.requestSingleInstanceLock(), 'Close Skaro before restoring its agent');
    const data = app.getPath('userData');
    state = catPilotState(data);
    const source = state.db.getRun(process.argv[2]!);
    assert(
      source &&
        source.projectId === state.db.shell.projectScope &&
        source.taskId === 'T-006' &&
        source.agent === 'skaro',
    );
    const settings = state.db.getSetting<BuiltinTaskStart | null>(
      `builtin.run.${source.id}.settings`,
      null,
    );
    assert(settings);
    const current = state.db.listRuns(source.projectId, source.taskId)[0]!;
    assert.equal(current.agent, 'codex');
    assert.equal(new TaskExecution(state.db, current.id).read().enabled, false);
    services = await createServices(state, data, () => {}, {
      async builtinTasks() {
        preparations++;
        throw new Error('Restoration does not authorize model execution');
      },
    });
    const context = services.projects.get(source.projectId);
    const before = await context.store.readTask(source.taskId);
    await services.runs.handoffBuiltin({
      projectId: source.projectId,
      taskId: source.taskId,
      settings,
      signal: new AbortController().signal,
    });
    const restored = services.db.listRuns(source.projectId, source.taskId)[0]!;
    assert.equal(restored.agent, 'skaro');
    assert.equal(restored.model, source.model);
    assert.deepEqual(services.db.getSetting(`builtin.run.${restored.id}.settings`, null), settings);
    assert.equal(new TaskExecution(services.db, restored.id).read().enabled, false);
    assert.deepEqual(await context.store.readTask(source.taskId), before);
    assert.equal(preparations, 0);
    console.log(
      JSON.stringify({
        restored: true,
        task: source.taskId,
        agent: restored.agent,
        sourceRun: source.id,
        runId: restored.id,
        modelRequests: 0,
        taskUnchanged: true,
      }),
    );
    code = 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Agent restoration failed');
  } finally {
    if (services) {
      await services.modelCatalog.close();
      await services.modelSettings.close();
      await Promise.allSettled([
        services.runs.close(),
        services.chats.close(),
        services.mcp.close(),
        services.graph.close(),
        services.ci.close(),
      ]);
      services.projects.close();
    }
    await closeBackground();
    state?.db.close();
    app.exit(code);
  }
});
