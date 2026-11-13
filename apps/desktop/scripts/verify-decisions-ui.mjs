/* global window, document, innerHeight */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';
import {
  verifyDecisionViews,
  verifyFeedAnswerRace,
  verifySaveRetry,
  verifyForeignScope,
} from './decisions-ui-details.mjs';

const require = createRequire(import.meta.url);
const { _electron, expect } = require('@playwright/test');
const projectId = '78bc2cd3-981b-40ed-a395-c6c6bc7da51b',
  taskId = 'T-010';
const live = process.argv.includes('--live');
const resumePath = process.argv.find((arg) => arg.startsWith('--resume='))?.slice(9);
const resumed = resumePath ? JSON.parse(await readFile(resumePath, 'utf8')) : undefined;
if (resumed) assert.equal(resumed.projectId, projectId);
const directory = join(
  process.env.APPDATA,
  'Skaro',
  'verification',
  `decisions-ui-${randomUUID()}`,
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
let electron = await _electron.launch({ args: [resolve('apps/desktop')], env, timeout: 60000 });
let page = await electron.firstWindow();
page.setDefaultTimeout(30000);
const proof = { projectId, directory, live, errors: [], stages: [] };
if (resumePath) proof.resumedFrom = resumePath;
page.on('pageerror', (error) => proof.errors.push(error.message));
const invoke = (method, ...args) =>
  page.evaluate(([m, a]) => window.skaro.invoke(m, ...a), [method, args]);
const stage = (name, data) => {
  proof.stages.push({ name, ...data });
  console.log(JSON.stringify({ name, ...data }));
};
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
const counter = () => page.locator('[data-decision-button]');
let sent = false;
try {
  await page.waitForFunction(() => window.skaro?.invoke);
  assert.deepEqual(await invoke('tabs.get'), { projects: [projectId], active: projectId });
  await expect(counter()).toHaveCount(0);
  await openProject();
  await expect(counter()).toBeVisible();
  const initial = await invoke('decisions.list', projectId);
  stage('scoped-read-model', { count: initial.length });
  stage('foreign-scope-refused', await verifyForeignScope(invoke));
  await counter().click();
  await expect(queue()).toBeVisible();
  await expect(queue().locator('[data-decision-list]')).toHaveAttribute('aria-busy', 'false');
  await page.screenshot({ animations: 'disabled', path: join(directory, 'queue-initial.png') });
  await page.keyboard.press('Escape');
  await expect(queue()).toHaveCount(0);
  await expect(counter()).toBeFocused();
  await page.getByRole('button', { name: 'Фоновая работа', exact: true }).click();
  await page.getByRole('button', { name: 'Журнал проекта', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Журнал проекта', exact: true })).toBeVisible();
  const archive = await invoke('activity.page', projectId);
  stage('durable-project-journal', { rows: archive.jobs.length, nextCursor: archive.nextCursor });
  await page.screenshot({ animations: 'disabled', path: join(directory, 'journal.png') });
  await page.keyboard.press('Escape');
  if (live) {
    await openTask();
    const before = await invoke('task.open', projectId, taskId, { paged: true });
    assert.equal(
      before.settings.agent,
      'codex',
      'Use the actual signed-in task agent without substitution',
    );
    assert(
      resumed || !before.timeline.interactions.some((row) => row.kind === 'question'),
      'Do not replace an owner question',
    );
    const marker = `AC4_${randomUUID().slice(0, 8)}`;
    const prompt = `Для проверки общения нужно моё решение: только объяснить порядок проверки или отложить проверку. Выбирать за меня нельзя. Покажи карточку с этими двумя вариантами и дождись ответа. Не реализуй T-010, не читай и не меняй файлы, не запускай команды. После ответа напиши только ${marker} и закончи. Другие инструменты, кроме вопроса, не вызывай.`;
    if (!resumed)
      await invoke('task.send', projectId, taskId, { text: prompt, commandId: randomUUID() });
    sent = true;
    let feed = page.locator('.task-conversation .fd-card.question');
    await expect(feed).toBeVisible({ timeout: 120000 });
    const question = (await invoke('decisions.list', projectId)).find(
      (row) =>
        row.origin.id === taskId &&
        row.kind === 'interaction' &&
        row.interaction.kind === 'question',
    );
    assert(question, 'The real question must enter the shared projection');
    if (resumed)
      assert.equal(
        question.id,
        resumed.decision.id,
        "Resume only this driver's unanswered question",
      );
    proof.decision = {
      id: question.id,
      revision: question.revision,
      delivery: question.interaction.delivery,
    };
    const pinned = await feed.evaluate((node) => {
      const r = node.getBoundingClientRect();
      const composer = document
        .querySelector('.task-conversation .composer')
        .getBoundingClientRect();
      return {
        pinned: !!node.closest('.pending-actions'),
        y: r.y,
        bottom: r.bottom,
        composer: composer.y,
        height: innerHeight,
      };
    });
    assert(pinned.pinned && pinned.y >= 0 && pinned.bottom <= pinned.composer);
    await counter().click();
    let card = queue()
      .locator('[data-project-decision]')
      .filter({ has: page.locator('.fd-card.question') });
    await expect(card).toHaveCount(1);
    await card.locator('.option').first().click();
    const selected = await card.getByRole('radio', { checked: true }).innerText();
    const size = await queue().boundingBox();
    await queue().getByRole('button', { name: 'Позже', exact: true }).click();
    assert((await invoke('decisions.list', projectId)).some((row) => row.id === question.id));
    await counter().click();
    await expect(card.getByRole('radio', { checked: true })).toHaveText(selected);
    // Project navigation remains available above the project-scoped backdrop.
    await page.locator('button.home').click();
    await expect(queue()).toHaveCount(0);
    await expect(counter()).toHaveCount(0);
    await openProject();
    await expect(queue()).toHaveCount(0);
    await counter().click();
    await expect(card.getByRole('radio', { checked: true })).toHaveText(selected);
    await page.screenshot({
      animations: 'disabled',
      path: join(directory, 'question-deferred.png'),
    });
    if (process.argv.includes('--extended'))
      stage(
        'project-views-and-layout',
        await verifyDecisionViews({
          page,
          electron,
          invoke,
          projectId,
          question,
          directory,
          expect,
        }),
      );
    await page.reload();
    await openProject();
    await counter().click();
    await expect(card).toHaveCount(1);
    await card.locator('.option').first().click();
    await page.screenshot({
      animations: 'disabled',
      path: join(directory, 'question-restored.png'),
    });
    stage('pending-defer-navigation-reload', { pinned, modal: size });
    // Actual crash recovery: terminate only the Electron tree launched by this driver.
    // task.interrupt intentionally cancels a native question and is not a crash/restart substitute.
    if (!resumed) {
      const verificationPid = electron.process().pid;
      assert(Number.isSafeInteger(verificationPid) && verificationPid > 0);
      const closed = electron.waitForEvent('close', { timeout: 30000 });
      const stopped = spawnSync('taskkill', ['/PID', String(verificationPid), '/T', '/F']);
      await closed;
      proof.crash = { verificationPid, taskkillStatus: stopped.status };
      electron = await _electron.launch({ args: [resolve('apps/desktop')], env, timeout: 60000 });
      page = await electron.firstWindow();
      page.setDefaultTimeout(30000);
      page.on('pageerror', (error) => proof.errors.push(error.message));
      await page.waitForFunction(() => window.skaro?.invoke);
      await openProject();
    }
    assert((await invoke('decisions.list', projectId)).some((row) => row.id === question.id));
    await counter().click();
    card = queue()
      .locator('[data-project-decision]')
      .filter({ has: page.locator('.fd-card.question') });
    feed = page.locator('.task-conversation .fd-card.question');
    await expect(card).toHaveCount(1);
    await card.locator('.option').first().click();
    stage('pending-real-app-restart', { id: question.id });
    const invalid = await invoke('decisions.answer', projectId, question.id, question.revision, {
      kind: 'merge',
      action: { action: 'cancel' },
    }).then(
      () => 'accepted',
      (error) => String(error),
    );
    assert.match(invalid, /decision_answer_kind_invalid/);
    if (process.argv.includes('--extended')) {
      stage('save-error', await verifySaveRetry({ page, directory, expect }));
      await queue().getByRole('button', { name: 'Повторить', exact: true }).click();
    } else await card.getByRole('button', { name: 'Ответить', exact: true }).click();
    await expect(queue().getByText('Ответ сохранён.', { exact: true })).toBeVisible();
    await expect
      .poll(async () =>
        (await invoke('decisions.list', projectId)).some((row) => row.id === question.id),
      )
      .toBe(false);
    const stale = await invoke('decisions.answer', projectId, question.id, question.revision, {
      kind: 'respond',
      answer: {
        kind: 'question',
        answers: Object.fromEntries(
          question.interaction.questions.map((q) => [q.id, [q.options[0].label]]),
        ),
      },
    }).then(
      () => 'accepted',
      (error) => String(error),
    );
    assert.match(stale, /decision_stale/);
    await page.screenshot({ animations: 'disabled', path: join(directory, 'answered.png') });
    await page.keyboard.press('Escape');
    await openTask();
    await expect(feed).toHaveCount(0);
    await expect
      .poll(
        async () => (await invoke('task.open', projectId, taskId, { paged: true })).timeline.status,
        { timeout: 90000 },
      )
      .toBe('idle');
    const after = await invoke('task.open', projectId, taskId, { paged: true });
    assert.deepEqual(after.task.criteria, before.task.criteria);
    assert.equal(after.run.id, before.run.id);
    stage('global-answer-updates-feed', {
      staleRejected: true,
      run: after.run.id,
      taskStatus: after.task.status,
    });
    if (process.argv.includes('--extended'))
      stage(
        'feed-answer-race',
        await verifyFeedAnswerRace({
          page,
          invoke,
          projectId,
          taskId,
          previousId: question.id,
          directory,
          expect,
        }),
      );
  }
  assert.deepEqual(proof.errors, []);
  proof.passed = true;
} catch (error) {
  proof.error = error.stack ?? String(error);
  await page
    .screenshot({ animations: 'disabled', path: join(directory, 'failure.png') })
    .catch(() => undefined);
  console.log(JSON.stringify({ failure: proof.error, directory }));
  process.exitCode = 1;
} finally {
  if (sent)
    await invoke('task.interrupt', projectId, taskId).catch((error) => {
      proof.cleanupError = String(error);
      process.exitCode = 1;
    });
  await writeFile(join(directory, 'proof.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({ directory, passed: proof.passed, errors: proof.errors }));
  await electron.close();
}
