import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { join, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { catPilotState } from './cat-pilot-state';
import { createServices, type Services } from '../app-services';
import { closeNativeSessions } from '../native/client';
import { closeBackground } from '../background/client';
import { RESOURCE_POLICY_KEY } from '../resource-policy';
import { runChecks } from '../check-runner';
import { systemDocker } from '../task-environment-docker';
import { declaredComposeIdentity } from '../environment-compose-identity';
import { labelsOf, COMPOSE_PROJECT } from '@skaro/core';
import {
  eventually,
  resourceInventory,
  finishedTask,
  requireReleased,
} from './resource-workflow-observation';

// Genuine product services, registered Cat-pilot, configured Docker and authenticated managed agent.
app.setName('Skaro');
app.on('window-all-closed', () => undefined);
void app.whenReady().then(async () => {
  const data = app.getPath('userData');
  const state = catPilotState(data);
  const projectId = state.db.shell.projectScope!;
  const savedPolicy = state.db.getSetting<Record<string, unknown>>(RESOURCE_POLICY_KEY, {});
  const directory = join(data, 'verification', `resource-workflow-${randomUUID()}`);
  const proof: Record<string, unknown> = { projectId, startedAt: new Date().toISOString() };
  let services: Services | undefined, window: BrowserWindow | undefined, taskId: string | undefined;
  let code = 1;
  const stage = (name: string) => process.send?.({ stage: name, taskId });
  try {
    await mkdir(directory, { recursive: true });
    services = await createServices(state, data, () => undefined, {
      builtinEntries: resolve('apps/desktop/out/main'),
    });
    const s = services;
    const context = s.projects.get(projectId);
    const policy = (changes: Record<string, unknown>) => {
      s.db.setSetting(RESOURCE_POLICY_KEY, { ...savedPolicy, ...changes });
      s.resources.manager.poke();
    };
    await s.agents.requireReady('codex');
    const title = 'Аудит штатного окружения Cat-pilot и допуска ресурсов RC-2';
    const task =
      (await context.load()).tasks.find((item) => item.title === title) ??
      (await context.store.createTask({
        title,
        agent: 'codex',
        body: '## Цель\n\nПроверить существующий Cat-pilot только чтением: HTML, CSS, управление анимацией и штатный Docker-контур. Не менять исходники, дизайн, зависимости или критерии других задач.\n\n## Критерии приёмки\n\n- [ ] Проверен синтаксис js/controls.js штатной командой node --check.\n- [ ] Ручной просмотр штатной страницы остаётся доступен после завершения агента.\n',
      }));
    taskId = task.id;
    context.invalidate();
    await s.runs.setSettings(projectId, taskId, {
      agent: 'codex',
      permissionMode: 'full',
      planFirst: false,
      isolation: 'worktree',
    });
    const before = await resourceInventory(context.root);
    proof.before = before;
    const taskOwner = `task:${taskId}`;
    const prompt =
      'Выполни только реальную проверку чтением: node --check js/controls.js и чтение index.html. Кратко сообщи результат и закончи ход. Не меняй файлы, не делай коммит, не запускай службы, не предлагай C4 и не вызывай submit_result: ручную проверку среды выполнит владелец отдельно.';
    policy({ reserveRamBytes: 2 ** 50 });
    stage('worktree-budget-blocked');
    await s.runs.send(projectId, taskId, { text: prompt, commandId: randomUUID() });
    const blocked = await eventually(
      () =>
        s.db.admission
          .all()
          .find(
            (lease) =>
              lease.projectId === projectId &&
              lease.ownerId === taskOwner &&
              lease.state === 'waiting_resource' &&
              lease.reason === 'budget_ramBytes',
          ),
      Boolean,
      'waiting before expensive task effect',
    );
    assert(blocked);
    await delay(2200);
    assert.deepEqual(await resourceInventory(context.root), before);
    await s.runs.interrupt(projectId, taskId);
    policy({});
    await delay(2200);
    assert.equal(s.db.admission.get(projectId, blocked.id)?.state, 'stopped_by_owner');
    assert.deepEqual(await resourceInventory(context.root), before);
    proof.cancelledWaiting = blocked.id;
    stage('task-readmission');
    const previous = (await s.runs.open(projectId, taskId)).timeline?.turns.length ?? 0;
    await s.runs.send(projectId, taskId, { text: prompt, commandId: randomUUID() });
    const view = await finishedTask(s, projectId, taskId, previous);
    assert.equal(view.timeline?.turns.at(-1)?.outcome, 'done');
    assert(
      view.timeline?.items.some(
        (item) =>
          item.kind === 'command' &&
          item.status === 'done' &&
          item.turnId === view.timeline?.turns.at(-1)?.id &&
          item.command.includes('controls.js'),
      ),
      'The real agent must execute the check',
    );
    assert(
      s.resources
        .holdings(projectId, taskOwner)
        .every((held) => !held.lease.cost.model && !held.lease.cost.build),
    );
    await s.runs.interrupt(projectId, taskId);
    requireReleased(s, projectId, taskOwner);
    const worktree = await s.runs.workdir(projectId, taskId);
    assert.notEqual(worktree, context.root);
    const configured = (await context.load()).config;
    await s.resources.scope(projectId, `verification:${taskId}`, () =>
      runChecks(worktree, configured.checks ?? []),
    );
    // The same normal task service that handles external local links starts and owns manual review.
    const engine = (s.runs as unknown as { engine: import('../task-run-engine').TaskRunEngine })
      .engine;
    const description = await engine.environments.describe({ projectId, taskId });
    const url = `http://localhost:${description.identity.ports.UI_PORT}`;
    policy({ environment: 0 });
    stage('review-budget-blocked');
    const opening = s.runs.openExternal(projectId, taskId, url, async (address) => {
      window = new BrowserWindow({
        show: false,
        width: 1280,
        height: 800,
        webPreferences: { backgroundThrottling: false },
      });
      await window.loadURL(address);
    });
    void opening.catch(() => undefined);
    await eventually(
      () =>
        s.db.admission
          .all()
          .find(
            (lease) =>
              lease.ownerId === `environment:${taskId}` &&
              lease.state === 'waiting_resource' &&
              lease.reason === 'budget_environment',
          ),
      Boolean,
      'review environment waiting',
    );
    const queued = await resourceInventory(context.root);
    await delay(2200);
    assert.deepEqual(await resourceInventory(context.root), queued);
    policy({});
    await opening;
    assert(window);
    const containers = await systemDocker.inspect();
    const own = containers.find(
      (container) => labelsOf(container)[COMPOSE_PROJECT] === description.identity.name,
    );
    const persistent = containers.find(
      (container) => labelsOf(container)[COMPOSE_PROJECT] === 'cat-pilot-dev',
    );
    assert(own && persistent);
    assert(declaredComposeIdentity(own, description.identity, configured.environment, data));
    assert(
      !declaredComposeIdentity(persistent, description.identity, configured.environment, data),
    );
    proof.composeOwnership = { own: own.Id, persistent: persistent.Id, foreignRejected: true };
    await delay(2000);
    const rendered = await window.webContents.executeJavaScript(`({ title: document.title,
      animations: document.getAnimations().length, width: document.body.getBoundingClientRect().width })`);
    assert(rendered.animations > 0 && rendered.width > 0);
    await writeFile(
      join(directory, 'cat-pilot.png'),
      (await window.webContents.capturePage()).toPNG(),
    );
    const manual = s.resources.holdings(projectId, `review:${taskId}`);
    assert.equal(manual.length, 1);
    assert.equal(manual[0]!.lease.cost.model, 0);
    assert.equal(manual[0]!.lease.locks.length, 1);
    const runtime = s.resources.holdings(projectId, `environment:${taskId}`);
    assert.equal(runtime[0]?.lease.cost.ramBytes, 64 * 1024 ** 2);
    assert.equal(runtime[0]?.lease.cost.cpuMillis, 250);
    proof.environmentCost = runtime[0]!.lease.cost;
    stage('chat-during-manual-review');
    policy({ model: 0 });
    const chat = await s.chats.create(
      projectId,
      { agent: 'codex', permissionMode: 'full' },
      {
        text: 'Проверка диспетчера RC-2. Только прочитай index.html и назови title страницы. Ничего не изменяй, не запускай задачи, службы и C4.',
        commandId: randomUUID(),
      },
    );
    const waitingChat = await eventually(
      () =>
        s.db.admission
          .all()
          .find(
            (lease) =>
              lease.ownerId === `chat:${chat.id}` &&
              lease.checkpoint === 'model' &&
              ['waiting_resource', 'waiting_quota'].includes(lease.state) &&
              ['budget_model', 'account_slots'].includes(lease.reason),
          ),
      Boolean,
      'chat shares global model budget',
    );
    assert(waitingChat);
    assert.equal(s.db.getChat(chat.id)?.nativeSessionId, undefined);
    await s.chats.interrupt(projectId, chat.id);
    policy({});
    await delay(2200);
    assert.equal(s.db.admission.get(projectId, waitingChat.id)?.state, 'stopped_by_owner');
    await s.chats.send(projectId, chat.id, {
      text: 'Продолжи только чтение index.html и ответь названием страницы. Без правок и запуска служб.',
      commandId: randomUUID(),
    });
    await eventually(
      () => s.chats.open(projectId, chat.id),
      (chatView) =>
        chatView.timeline.turns.some((turn) => turn.outcome === 'done') &&
        chatView.timeline.status === 'idle',
      'real chat completed',
      240000,
    );
    await s.chats.interrupt(projectId, chat.id);
    requireReleased(s, projectId, `chat:${chat.id}`);
    assert.equal((await fetch(url)).status, 200);
    assert.equal(s.resources.holdings(projectId, `review:${taskId}`).length, 1);
    proof.reviewSurvivedAgent = { taskId, chatId: chat.id, url, rendered };
    stage('review-confirmed-stop');
    await s.runs.stopEnvironmentReview(projectId, taskId);
    requireReleased(s, projectId, `review:${taskId}`);
    requireReleased(s, projectId, `environment:${taskId}`);
    proof.after = await resourceInventory(context.root);
    proof.leases = s.db.admission
      .all()
      .filter(
        (lease) =>
          lease.projectId === projectId &&
          (lease.ownerId.includes(taskId!) || lease.ownerId === `chat:${chat.id}`),
      );
    proof.passed = true;
    code = 0;
  } catch (error) {
    proof.error = error instanceof Error ? error.stack : String(error);
    process.send?.({ error: proof.error });
  } finally {
    window?.destroy();
    if (services) {
      services.resources.stopAccepting();
      if (taskId) await services.runs.interrupt(projectId, taskId).catch(() => undefined);
      await closeNativeSessions();
      for (const close of [
        () => services!.commands.close(),
        () => services!.runs.close(),
        () => services!.chats.close(),
        () => services!.managedCaches.close(),
        () => services!.ci.close(),
        () => services!.mcp.close(),
        () => services!.graph.close(),
        () => services!.modelCatalog.close(),
        () => services!.modelSettings.close(),
        () => services!.coordinators.close(),
        () => services!.resources.close(),
        () => services!.projects.close(),
      ]) {
        try {
          await close();
        } catch (error) {
          proof.cleanupError = String(error);
          code = 1;
        }
      }
      await closeBackground();
    }
    state.db.setSetting(RESOURCE_POLICY_KEY, savedPolicy);
    await writeFile(join(directory, 'proof.json'), JSON.stringify(proof, null, 2));
    state.db.close();
    process.send?.({ proof: join(directory, 'proof.json'), code });
    app.exit(code);
  }
});
