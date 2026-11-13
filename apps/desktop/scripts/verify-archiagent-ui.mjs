/* global document */
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { browserSession, expect, project } from './archiagent-browser-session.mjs';
import { verifyBrowserC4, assertBrowserC4 } from './archiagent-browser-c4.mjs';

const directory = resolve(process.argv[2] ?? '');
const proof = { projectId: project, directory, errors: [], startedAt: new Date().toISOString() };
const browser = browserSession(directory, proof),
  invoke = browser.invoke;
const tasks = ['T-010', 'T-011'],
  marker = `AG1_BROWSER_${randomUUID().slice(0, 8)}`;
let policy, savedPolicy, incident, decision;
const timeline = async (task) => (await invoke('task.open', project, task)).timeline;
const completed = async (task, previous) => {
  await expect
    .poll(
      async () => {
        const current = await timeline(task);
        return (
          current.turns.length > previous &&
          !!current.turns.at(-1)?.outcome &&
          current.status === 'idle'
        );
      },
      { timeout: 240000 },
    )
    .toBe(true);
  return timeline(task);
};
try {
  try {
    await readFile(join(directory, 'browser-shared-proof.json'));
    const archive = join(directory, `browser-previous-${randomUUID()}`);
    await mkdir(archive);
    for (const name of [
      'browser-shared-proof.json',
      'joint-pending-pinned.png',
      'joint-one-shared-decision.png',
      'joint-decision-after-restart.png',
      'joint-answer-applied-once.png',
    ]) {
      try {
        await copyFile(join(directory, name), join(archive, name));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    proof.previousBrowserEvidence = archive;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const preflight = JSON.parse(await readFile(join(directory, 'preflight.json'), 'utf8'));
  const inspection = JSON.parse(
    await readFile(join(directory, 'inspect-proof.json'), 'utf8'),
  ).inspection;
  assert(preflight.passed && preflight.projectId === project);
  const environment = inspection.environments.find((e) => e.taskId === tasks[0]).description;
  const url = environment.config.ready.replace('{UI_PORT}', environment.identity.ports.UI_PORT);
  const resource = inspection.resources.find(
    (r) => r.kind === 'environment' && r.owner.id === tasks[0],
  );
  assert(resource && resource.consumers.length === 0);
  await assert.rejects(fetch(url, { signal: AbortSignal.timeout(4000) }));
  await browser.launch();
  const activation = await invoke('archiagent.status', project);
  assert(
    activation.compatible && activation.dispatch.enabled && activation.protocol === 'impact-v1',
  );
  proof.realC4 = await verifyBrowserC4(browser, directory);
  assert(
    !(await invoke('decisions.list', project)).some((d) =>
      ['T-012', 'T-013'].includes(d.origin.id),
    ),
  );
  policy = await invoke('incidents.policy', project);
  proof.originalPolicy = policy;
  savedPolicy = await invoke(
    'incidents.setPolicy',
    project,
    { ...policy, mode: 'confirm', expiresAt: Date.now() + 3600000 },
    policy.revision,
  );
  proof.testPolicy = savedPolicy;
  const criteria = new Map();
  for (const task of tasks) {
    const view = await invoke('task.open', project, task);
    assert.equal(view.settings.agent, 'codex');
    assert.equal(view.timeline.interactions.length, 0);
    criteria.set(task, view.task.criteria);
    const commandId = randomUUID(),
      instruction = 'Проверь общий сервис в read-only browser-приёмке AG-1';
    await invoke('task.send', project, task, {
      commandId,
      text:
        `${instruction}. Это ограниченное поручение владельца, не реализация исходной задачи. Реальный зарегистрированный сервис ${resource.id} недоступен по ${url}, HTTP readiness только что завершился отказом соединения. Он общий для ${tasks.join(' и ')}. ` +
        `Вызови resume_task с command_id="${commandId}" и instruction="${instruction}"; затем report_task_blocker с cause="environment", code="service_unavailable", resource_id="${resource.id}", condition="environment-ready", reason="AG-1 browser: реальный readiness ${url} недоступен" и закончи ход. ` +
        `Только после штатного восстановления напиши ${marker}_${task} и закончи. Не читай и не меняй файлы, не запускай shell, не реализуй исходную задачу, не меняй критерии и не сдавай результат. Разрешены только два названных инструмента; после восстановления никаких инструментов.`,
    });
    await completed(task, view.timeline.turns.length);
  }
  incident = (await invoke('incidents.list', project)).find(
    (r) =>
      r.state === 'open' &&
      r.subject.id === resource.id &&
      r.protocol?.ownerPolicyRevision === savedPolicy.revision,
  );
  assert(incident?.protocol?.decisionId && incident.protocol.subscriptions.length === 2);
  const id = `coordinator:${incident.protocol.decisionId}`;
  decision = (await invoke('decisions.list', project)).find((d) => d.id === id);
  assert(decision);
  await invoke('task.interrupt', project, tasks[1]);
  const turns = new Map(
    await Promise.all(tasks.map(async (task) => [task, (await timeline(task)).turns.length])),
  );
  await browser.openProject();
  await browser.page
    .getByText('Аудит штатного окружения Cat-pilot и допуска ресурсов RC-2', { exact: true })
    .first()
    .click();
  const pending = browser.page
    .locator('.task-conversation .pending-actions .fd-card')
    .filter({ has: browser.page.getByRole('button', { name: 'Разрешить', exact: true }) });
  await expect(pending).toHaveCount(1);
  const geometry = () =>
    pending.evaluate((node) => {
      const r = node.getBoundingClientRect(),
        composer = document.querySelector('.task-conversation .composer').getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, composer: composer.top };
    });
  const beforeScroll = await geometry();
  assert(beforeScroll.top >= 0 && beforeScroll.bottom <= beforeScroll.composer);
  const scroller = browser.page.locator('.task-conversation .feed-wrap .scroller');
  const range = () =>
    browser.page.locator('.task-conversation [data-history-index]').evaluateAll((nodes) => {
      const indexes = nodes.map((node) => Number(node.getAttribute('data-history-index')));
      return { min: Math.min(...indexes), max: Math.max(...indexes), shown: indexes.length };
    });
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect.poll(async () => (await range()).min).toBeGreaterThan(0);
  const historyBefore = await range();
  await scroller.evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect
    .poll(async () => {
      const current = await range();
      if (current.min !== 0) return false;
      const currentGeometry = await geometry();
      proof.realHistoryPages = { before: historyBefore, after: current };
      return currentGeometry.top >= 0 && currentGeometry.bottom <= currentGeometry.composer;
    })
    .toBe(true);
  proof.pinnedDuringHistory = beforeScroll;
  await browser.screenshot('joint-pending-pinned');
  await browser.page.locator('[data-decision-button]').click();
  const queue = () => browser.page.getByRole('dialog', { name: 'Требуют ответа', exact: true });
  await expect(queue().locator(`[data-project-decision="${id}"]`)).toHaveCount(1);
  await browser.screenshot('joint-one-shared-decision');
  proof.checkpoint = { incident, decision, marker, turns: [...turns] };
  await writeFile(join(directory, 'browser-shared-proof.json'), JSON.stringify(proof, null, 2));
  proof.crashedPid = await browser.crash();
  await browser.launch();
  await assertBrowserC4(browser, proof.realC4);
  assert.deepEqual(
    (await invoke('decisions.list', project)).find((d) => d.id === id),
    decision,
  );
  for (const task of tasks) assert.equal((await timeline(task)).turns.length, turns.get(task));
  await browser.openProject();
  await browser.page.locator('[data-decision-button]').click();
  const card = queue().locator(`[data-project-decision="${id}"]`);
  await expect(card).toHaveCount(1);
  await browser.screenshot('joint-decision-after-restart');
  await card.getByRole('button', { name: 'Разрешить', exact: true }).click();
  const resumed = await completed(tasks[0], turns.get(tasks[0]));
  assert(
    resumed.items.some(
      (item) =>
        item.kind === 'message' &&
        item.role === 'agent' &&
        item.text?.trim() === `${marker}_${tasks[0]}` &&
        item.turnId === resumed.turns.at(-1).id,
    ),
  );
  assert.equal((await timeline(tasks[1])).turns.length, turns.get(tasks[1]));
  await invoke('task.interrupt', project, tasks[0]);
  await assert.rejects(
    invoke('task.respond', project, tasks[0], id, { kind: 'approval', choice: 'allow_once' }),
  );
  const resolved = (await invoke('incidents.list', project)).find((r) => r.id === incident.id);
  await assertBrowserC4(browser, proof.realC4);
  assert.equal(resolved.state, 'resolved');
  assert.equal(resolved.protocol.attempts, 1);
  assert((await fetch(url, { signal: AbortSignal.timeout(4000) })).ok);
  for (const task of tasks)
    assert.deepEqual((await invoke('task.open', project, task)).task.criteria, criteria.get(task));
  await browser.screenshot('joint-answer-applied-once');
  proof.result = {
    incident: incident.id,
    decision: id,
    marker,
    oneEffect: true,
    stoppedTaskPreserved: tasks[1],
    nativeContinuation: tasks[0],
    obsoleteCompletedMergeCardsAbsent: true,
  };
  assert.deepEqual(proof.errors, []);
  proof.passed = true;
} catch (error) {
  proof.error = error.stack ?? String(error);
  await browser.screenshot('joint-browser-failure').catch(() => undefined);
  process.exitCode = 1;
} finally {
  try {
    for (const task of tasks) await invoke('task.interrupt', project, task);
    if (policy) {
      const current = await invoke('incidents.policy', project);
      assert.equal(
        current.revision,
        savedPolicy.revision,
        'Do not overwrite concurrent owner policy edits',
      );
      await invoke('incidents.setPolicy', project, policy, current.revision);
    }
  } catch (error) {
    proof.cleanupError = String(error);
    process.exitCode = 1;
  }
  await writeFile(join(directory, 'browser-shared-proof.json'), JSON.stringify(proof, null, 2));
  await browser.close();
  console.log(
    JSON.stringify({
      directory,
      passed: proof.passed,
      error: proof.error,
      cleanupError: proof.cleanupError,
    }),
  );
}
