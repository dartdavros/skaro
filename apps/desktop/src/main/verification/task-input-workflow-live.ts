import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { app } from 'electron';
import { catPilotState } from './cat-pilot-state';
import { createServices, type Services } from '../app-services';
import { closeCoordinatorVerification } from './coordinator-live-close';
import { verifyProjectScope } from './project-scope-proof';
import { eventually } from './resource-workflow-observation';
import { sessionHandlers } from '../session-handlers';
import { taskInputSnapshot } from '../task-preflight-inputs';
import { isolationContainers } from './environment-isolation-observation';
import { isOwnerCommandMessage } from '../owner-command-history';

app.setName('Skaro');
if (!app.requestSingleInstanceLock()) {
  process.send?.({ blocked: 'The real Skaro profile is already open' });
  app.exit(1);
}
app.on('window-all-closed', () => undefined);

async function verify(s: Services) {
  const { projectId: project } = verifyProjectScope(s);
  const context = s.projects.get(project);
  const handlers = sessionHandlers(s);
  const task = await context.store.createTask({
    title: 'Проверка смены входных данных активного хода и остановки окружения кандидата',
    agent: 'codex',
    body: '## Цель\n\nПроверить чтение актуального задания Cat-pilot после изменения входов. Только чтение. Без публикации или изменения исходников.',
  });
  const marker = randomUUID();
  context.invalidate();
  process.send?.({ task: task.id });
  await handlers['task.setSettings'](project, task.id, {
    agent: 'codex',
    permissionMode: 'ask',
    planFirst: false,
    isolation: 'worktree',
  });
  const open = () => s.runs.open(project, task.id);
  try {
    s.commands.accept('task.send', project, task.id, {
      commandId: randomUUID(),
      text: 'Только чтение. Изучи текущие требования через read_project_memory и объясни действующие проверки Cat-pilot. Не меняй файлы, не сдавай и не сливай результат.',
    });
    const working = await eventually(
      open,
      (v) => !!v.timeline?.turns.at(-1) && !v.timeline.turns.at(-1)?.outcome,
      'live native turn',
      180000,
    );
    const run = s.db.latestRun(project, task.id)!;
    assert(run.worktree && run.nativeSessionId);
    const old = working.timeline!.turns.at(-1)!.id;
    await context.store.updateTask(task.id, {
      body: task.body + '\n\nКонтрольная версия проверки: ' + marker,
    });
    context.invalidate();
    const commandId = randomUUID();
    s.commands.accept('task.send', project, task.id, {
      commandId,
      text: `Прочитай именно текущую задачу через read_project_memory с source="${task.path}". Ответь контрольной версией проверки из её текста. Только чтение. Не меняй файлы, не сдавай результат.`,
    });
    const done = await eventually(
      open,
      (v) =>
        !!v.timeline?.items.some(
          (i) => i.kind === 'message' && i.role === 'agent' && i.text?.includes(marker),
        ) && v.timeline?.turns.at(-1)?.outcome === 'done',
      'same thread completed the revised instruction',
      240000,
    );
    assert.equal(done.timeline!.turns.find((t) => t.id === old)?.outcome, 'interrupted');
    assert.equal(done.timeline!.items.filter((i) => isOwnerCommandMessage(i, commandId)).length, 1);
    assert.equal(s.db.latestRun(project, task.id)?.nativeSessionId, run.nativeSessionId);
    process.send?.({ task: task.id, interrupted: old, successor: done.timeline!.turns.at(-1)!.id });
  } finally {
    await s.runs.interrupt(project, task.id);
  }
  const run = s.db.latestRun(project, task.id)!;
  const inputs = await taskInputSnapshot(s.db, context, await context.load(), task.id);
  const candidate = await handlers['local.prepareCandidate'](
    project,
    task.id,
    await context.git.head('HEAD', run.worktree!),
    inputs.version,
  );
  const engine = s.runs['engine'];
  process.send?.({ candidate: candidate.id });
  const op = await eventually(
    () => engine.integrations.store.find(project, candidate.id),
    (v) =>
      !!v &&
      !engine.integrations.executing(v.id) &&
      ['ready', 'failed', 'waiting', 'paused'].includes(v.state),
    'local integration finished its normal verification and environment stop',
    240000,
  );
  assert.equal(op?.state, 'ready', op?.error);
  assert(op && !op.publish);
  const manifest = await s.runs.localCandidates.verify(project, op.id);
  const env = await engine.environments.describe({
    projectId: project,
    taskId: 'integration-' + op.id,
  });
  const containers = await isolationContainers(env.identity.name);
  assert(!containers.some((c) => c.State.Running));
  const items = (await engine.integrations.history.state(op)).state.items;
  assert(!items.some((i) => i.kind === 'notice' && i.text.includes('resource_in_use')));
  assert(
    s.db
      .listEvents(project, 500)
      .some(
        (event) =>
          event.kind === 'resource_lifecycle' &&
          event.data.step === 'stop' &&
          event.data.state === 'verified' &&
          s.db.resources.get(String(event.data.resource))?.identity.composeProject ===
            env.identity.name,
      ),
  );
  process.send?.({ verified: manifest.id, environment: env.identity.name, stopped: true });
}

void app.whenReady().then(async () => {
  const data = app.getPath('userData'),
    state = catPilotState(data);
  let services: Services | undefined,
    code = 1;
  try {
    services = await createServices(state, data, () => undefined, {
      builtinEntries: resolve('apps/desktop/out/main'),
      silentVerification: true,
    });
    await verify(services);
    code = 0;
  } catch (error) {
    console.error(error);
  } finally {
    try {
      if (services) await closeCoordinatorVerification(services);
    } catch (error) {
      console.error(error);
      code = 1;
    }
    state.db.close();
    app.exit(code);
  }
});
