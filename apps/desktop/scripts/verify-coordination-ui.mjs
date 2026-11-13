/* global window, document, innerHeight */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';

const require = createRequire(import.meta.url);
const { _electron, expect } = require('@playwright/test');
const projectId = '78bc2cd3-981b-40ed-a395-c6c6bc7da51b',
  taskId = 'T-010';
const directory = join(
  process.env.APPDATA,
  'Skaro',
  'verification',
  `coordination-ui-${randomUUID()}`,
);
await mkdir(directory, { recursive: true });
const env = { ...cleanCommandEnvironment(), SKARO_VERIFICATION_PROJECT: projectId };
for (const name of [
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'ALLUSERSPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
])
  if (process.env[name]) env[name] = process.env[name];
let electron,
  page,
  initial,
  sent = false;
const proof = { projectId, directory, errors: [], stages: [] };
const stage = (name, data) => {
  proof.stages.push({ name, ...data });
  console.log(JSON.stringify({ name, ...data }));
};
const launch = async () => {
  electron = await _electron.launch({ args: [resolve('apps/desktop')], env, timeout: 60000 });
  page = await electron.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => proof.errors.push(error.message));
  await page.waitForFunction(() => window.skaro?.invoke);
};
const invoke = (method, ...args) =>
  page.evaluate(([m, a]) => window.skaro.invoke(m, ...a), [method, args]);
const openProject = async () => {
  await page.locator('button.home').click();
  await page.getByText('Cat-pilot', { exact: true }).last().click();
};
const openTask = async () => {
  await page
    .getByText('Аудит штатного окружения Cat-pilot и допуска ресурсов RC-2', { exact: true })
    .first()
    .click();
  await page.locator('.task-conversation .composer textarea').waitFor();
};
const queue = () => page.getByRole('dialog', { name: 'Требуют ответа', exact: true });
const card = () =>
  queue()
    .locator('[data-project-decision]')
    .filter({ has: page.locator('.fd-card.question') });
const receipts = () => {
  const db = new DatabaseSync(join(process.env.APPDATA, 'Skaro', 'skaro.db'), { readOnly: true });
  try {
    return db
      .prepare(
        "SELECT count(*) AS n FROM settings WHERE key LIKE 'coordination.decision-reply.v1.%'",
      )
      .get().n;
  } finally {
    db.close();
  }
};
try {
  await launch();
  assert.deepEqual(await invoke('tabs.get'), { projects: [projectId], active: projectId });
  initial = (await invoke('coordinator.state', projectId)).dispatch;
  assert(initial.enabled);
  await openProject();
  await openTask();
  const before = await invoke('task.open', projectId, taskId);
  assert.equal(before.settings.agent, 'codex');
  assert(!before.timeline.interactions.some((i) => i.kind === 'question'));
  const marker = `AC5_ANSWER_${randomUUID().slice(0, 8)}`;
  const text = `Для проверки общения нужно моё решение: объяснить порядок проверки или отложить проверку. Покажи карточку с этими вариантами и дождись ответа. Не реализуй T-010, не читай и не меняй файлы, не запускай команды, не вызывай resume_task или submit_result. После ответа напиши только ${marker} и закончи. Другие инструменты, кроме вопроса, не вызывай.`;
  await invoke('task.send', projectId, taskId, { text, commandId: randomUUID() });
  sent = true;
  const feed = () => page.locator('.task-conversation .fd-card.question');
  await expect(feed()).toBeVisible({ timeout: 120000 });
  const decision = (await invoke('decisions.list', projectId)).find(
    (d) => d.origin.id === taskId && d.kind === 'interaction' && d.interaction.kind === 'question',
  );
  assert(decision);
  proof.decision = { id: decision.id, revision: decision.revision, raw: decision.interaction.id };
  const pinned = await feed().evaluate((node) => {
    const r = node.getBoundingClientRect(),
      composer = document.querySelector('.task-conversation .composer').getBoundingClientRect();
    return {
      pinned: !!node.closest('.pending-actions'),
      y: r.y,
      bottom: r.bottom,
      composer: composer.y,
      height: innerHeight,
    };
  });
  assert(pinned.pinned && pinned.y >= 0 && pinned.bottom <= pinned.composer);
  const off = await invoke('coordinator.setDispatch', projectId, false, initial.revision);
  const countBefore = receipts();
  await page.locator('[data-decision-button]').click();
  await expect(card()).toHaveCount(1);
  await card().locator('.option').first().click();
  const geometry = await queue().boundingBox();
  await card().getByRole('button', { name: 'Ответить', exact: true }).click();
  await expect(
    queue().getByText('Ответ не сохранён. Попробуйте ещё раз.', { exact: true }),
  ).toBeVisible();
  assert.equal(receipts(), countBefore, 'Suspension must reject before claiming an answer receipt');
  assert((await invoke('decisions.list', projectId)).some((d) => d.id === decision.id));
  const afterGeometry = await queue().boundingBox();
  assert(Math.abs(geometry.height - afterGeometry.height) < 1);
  await page.screenshot({
    animations: 'disabled',
    path: join(directory, 'dispatch-suspended.png'),
  });
  stage('dispatch-off-keeps-pending-answer', {
    revision: off.revision,
    pinned,
    receiptUnchanged: true,
    stableHeight: afterGeometry.height,
  });
  const turns = (await invoke('task.open', projectId, taskId)).timeline.turns.length;
  const pid = electron.process().pid;
  assert(Number.isSafeInteger(pid) && pid > 0);
  const closed = electron.waitForEvent('close', { timeout: 30000 });
  const killed = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  await closed;
  assert.equal(killed.status, 0);
  await launch();
  assert.deepEqual((await invoke('coordinator.state', projectId)).dispatch, off);
  await openProject();
  assert((await invoke('decisions.list', projectId)).some((d) => d.id === decision.id));
  const restored = await invoke('task.open', projectId, taskId);
  assert.equal(
    restored.timeline.turns.length,
    turns,
    'No model replay while dispatch is suspended',
  );
  assert.deepEqual(restored.task.criteria, before.task.criteria);
  await invoke('task.interrupt', projectId, 'T-006');
  const activity = await invoke('activity.page', projectId);
  await page.locator('[data-decision-button]').click();
  await expect(card()).toHaveCount(1);
  await card().locator('.option').first().click();
  await page.screenshot({
    animations: 'disabled',
    path: join(directory, 'question-after-crash.png'),
  });
  stage('crash-restart-preserves-question-and-stop', {
    pid,
    question: decision.id,
    turns,
    journalRows: activity.jobs.length,
  });
  const on = await invoke('coordinator.setDispatch', projectId, true, off.revision);
  const retry = queue().getByRole('button', { name: 'Повторить', exact: true });
  if (await retry.count()) await retry.click();
  else await card().getByRole('button', { name: 'Ответить', exact: true }).click();
  await expect(queue().getByText('Ответ сохранён.', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await invoke('decisions.list', projectId)).some((d) => d.id === decision.id))
    .toBe(false);
  await page.keyboard.press('Escape');
  await openTask();
  await expect(feed()).toHaveCount(0);
  await expect
    .poll(
      async () => {
        const view = await invoke('task.open', projectId, taskId);
        return (
          view.timeline.status === 'idle' &&
          view.timeline.turns.at(-1)?.outcome === 'done' &&
          view.timeline.items.some(
            (item) =>
              item.kind === 'message' &&
              item.role === 'agent' &&
              item.text?.trim() === marker &&
              item.turnId === view.timeline.turns.at(-1)?.id,
          )
        );
      },
      { timeout: 120000 },
    )
    .toBe(true);
  const after = await invoke('task.open', projectId, taskId);
  assert.deepEqual(after.task.criteria, before.task.criteria);
  assert.equal(after.run.id, before.run.id);
  assert.equal(
    after.timeline.turns.length,
    turns + 1,
    'Exactly one native continuation after answer',
  );
  stage('fresh-answer-delivered-once-after-enable', {
    revision: on.revision,
    run: after.run.id,
    marker,
    turns: after.timeline.turns.length,
    criteriaPreserved: true,
  });
  await page.screenshot({ animations: 'disabled', path: join(directory, 'answer-delivered.png') });
  assert.deepEqual(proof.errors, []);
  proof.passed = true;
} catch (error) {
  proof.error = error.stack ?? String(error);
  await page
    ?.screenshot({ animations: 'disabled', path: join(directory, 'failure.png') })
    .catch(() => undefined);
  console.log(JSON.stringify({ failure: proof.error, directory }));
  process.exitCode = 1;
} finally {
  try {
    if (sent) await invoke('task.interrupt', projectId, taskId);
    if (initial) {
      const current = (await invoke('coordinator.state', projectId)).dispatch;
      if (current.enabled !== initial.enabled)
        await invoke('coordinator.setDispatch', projectId, initial.enabled, current.revision);
    }
  } catch (error) {
    proof.cleanupError = String(error);
    process.exitCode = 1;
  }
  await writeFile(join(directory, 'proof.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({ directory, passed: proof.passed, errors: proof.errors }));
  await electron?.close();
}
