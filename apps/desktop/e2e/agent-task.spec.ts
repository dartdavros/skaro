// Stage 5 end to end: a task with a real agent goes through the whole cycle — run in a worktree,
// "Вливай" in the task chat, merge_task, the confirmation card, the merge, the dependent task
// unblocked — and the feed comes back after a restart.
//
// Needs signed-in agents and spends a little of their usage, so it runs only on request:
//   SKARO_E2E_AGENTS=claude-code,codex SKARO_AGENTS_DIR=<shared agents dir> pnpm test:e2e agent-task

import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, makeRepo, openTask, send, openCalc, card } from './agent-task-support';
import { waitForCommand, waitTurnEnd } from './feed-test-support';
import { AppDb } from '@skaro/core';
import { launchApp, tempUserData } from './launch';

const agents = (process.env['SKARO_E2E_AGENTS'] ?? '').split(',').filter(Boolean);

for (const agent of agents) {
  test(`${agent}: task runs, merges, survives a restart and reverts from the feed`, async () => {
    test.setTimeout(30 * 60_000);
    const userData = tempUserData();
    const repo = makeRepo(userData);
    const taskId = 'T-001';
    const db = AppDb.open(join(userData, 'skaro.db'));
    const project = db.addProject({ name: 'Calc', path: repo });
    db.setOpenTabs([project.id], project.id);
    db.setSetting('ui.locale', 'ru');
    // Cheap and without permission prompts: the cycle is what is under test here.
    db.setSetting(`task.${project.id}.${taskId}.agent`, {
      agent,
      effort: 'low',
      permissionMode: 'full',
      planFirst: false,
      isolation: 'worktree',
    });
    db.close();

    let app = await launchApp(userData);
    let page = await app.firstWindow();
    await openTask(page, 'Исправить сложение');
    await page.getByRole('button', { name: 'Начать' }).click();

    // The first turn: the agent works in the worktree and finishes.
    await waitTurnEnd(page, 1);
    await expect(page.locator('.fd-user').first()).toContainText('Начни работу');
    const worktree = join(userData, 'worktrees', project.id, taskId);
    expect(readFileSync(join(worktree, 'src', 'math.js'), 'utf8')).toContain('a + b');

    // "Вливай": the agent calls merge_task, Skaro shows the card.
    await send(page, 'Вливай');
    const card = page.locator('.fd-card').filter({ hasText: 'Влить ветку задачи?' });
    await expect(card).toBeVisible({ timeout: 10 * 60_000 });
    await expect(card).toContainText('skaro/T-001');
    await card.getByRole('button', { name: 'Влить' }).click();
    await expect(page.getByText('Влито в main')).toBeVisible({ timeout: 60_000 });

    // D33: the merge keeps the task branch and worktree, including service/ignored data.
    expect(readFileSync(join(repo, 'src', 'math.js'), 'utf8')).toContain('a + b');
    expect(readFileSync(join(repo, '.skaro', 'tasks', 'T-001-fix-add.md'), 'utf8')).toContain(
      'status: done',
    );
    expect(git(repo, 'status', '--porcelain', '--untracked-files=no', '--', 'src')).toBe('');
    expect(existsSync(worktree)).toBe(true);
    expect(git(repo, 'worktree', 'list')).toContain(worktree.replaceAll('\\', '/'));
    const retainedBranch = git(worktree, 'symbolic-ref', '--short', 'HEAD');
    expect(retainedBranch).toMatch(/^skaro\/T-001/);
    expect(git(repo, 'show-ref', '--verify', `refs/heads/${retainedBranch}`)).toBeTruthy();
    await expect(page.locator('.chip').filter({ hasText: 'Готово' })).toBeVisible();

    // T-002 is no longer blocked.
    await page.getByRole('button', { name: 'Задачи', exact: true }).first().click();
    const dependent = page.getByRole('button', { name: /Добавить умножение/ });
    await expect(dependent).toBeVisible();
    await expect(dependent).not.toHaveClass(/dim/);
    await expect(dependent.locator('.lock')).toHaveCount(0);
    await app.close();

    // After a restart the feed of T-001 is rebuilt from its raw log.
    app = await launchApp(userData);
    page = await app.firstWindow();
    await openTask(page, 'Исправить сложение');
    await expect(page.locator('.fd-user')).toHaveCount(2);
    await expect(page.getByText('Влито в main')).toBeVisible();
    expect(existsSync(worktree)).toBe(true);
    expect(git(repo, 'worktree', 'list')).toContain(worktree.replaceAll('\\', '/'));
    await page.getByRole('button', { name: 'Отменить слияние', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Отменить слияние' });
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: `test-results/${agent}-revert-confirm.png` });
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    expect(readFileSync(join(repo, 'src', 'math.js'), 'utf8')).toContain('a + b');
    await page.getByRole('button', { name: 'Отменить слияние', exact: true }).click();
    await dialog.getByRole('button', { name: 'Отменить слияние', exact: true }).click();
    await expect(page.getByText('Слияние отменено', { exact: true })).toBeVisible();
    expect(readFileSync(join(repo, 'src', 'math.js'), 'utf8')).toContain('a - b');
    expect(readFileSync(join(repo, '.skaro', 'tasks', 'T-001-fix-add.md'), 'utf8')).toContain(
      'status: review',
    );
    expect(existsSync(worktree)).toBe(true);
    await page.screenshot({ path: `test-results/${agent}-revert-review.png` });
    await app.close();
    app = await launchApp(userData);
    page = await app.firstWindow();
    await openTask(page, 'Исправить сложение');
    await expect(page.getByText('Слияние отменено', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Отменить слияние', exact: true })).toHaveCount(
      0,
    );
    await app.close();
  });
}

for (const agent of agents) {
  test(`${agent}: asks before writing in "Спрашивать" and goes on after "Разрешить"`, async () => {
    test.setTimeout(20 * 60_000);
    const { app, page, worktree } = await openCalc(agent, { permissionMode: 'ask' });
    await send(page, 'Создай файл hello.txt с текстом hi. Больше ничего не делай.');
    const permission = card(page, /Разрешить/);
    await expect(permission).toBeVisible({ timeout: 10 * 60_000 });
    // Each request in turn, until the agent is done.
    while (true) {
      const open = page.locator('.fd-card').filter({ hasText: /Разрешить/ });
      const done = page.locator('.fd-bar');
      await expect(open.or(done).first()).toBeVisible({ timeout: 10 * 60_000 });
      if ((await done.count()) > 0) break;
      await open.first().getByRole('button', { name: 'Разрешить', exact: true }).click();
      await expect(open.first())
        .not.toBeVisible({ timeout: 60_000 })
        .catch(() => undefined);
    }
    await waitTurnEnd(page, 1);
    expect(readFileSync(join(worktree, 'hello.txt'), 'utf8').trim()).toBe('hi');
    await app.close();
  });

  test(`${agent}: plan first — the plan card, then work after "Одобрить"`, async () => {
    test.setTimeout(20 * 60_000);
    const { app, page, worktree } = await openCalc(agent, {
      permissionMode: 'full',
      planFirst: true,
    });
    await expect(page.locator('.composer')).toContainText('План');
    await page.getByRole('button', { name: 'Начать' }).click();
    const plan = card(page, 'План агента');
    await expect(plan).toBeVisible({ timeout: 10 * 60_000 });
    await plan.getByRole('button', { name: 'Одобрить' }).click();
    await expect(page.getByText('План одобрен')).toBeVisible();
    await expect
      .poll(() => readFileSync(join(worktree, 'src', 'math.js'), 'utf8'), { timeout: 10 * 60_000 })
      .toContain('a + b');
    await app.close();
  });

  test(`${agent}: "/" and "@" menus come from the agent and the project`, async () => {
    test.setTimeout(5 * 60_000);
    const { app, page } = await openCalc(agent, { permissionMode: 'full' });
    const box = page.locator('.composer textarea');
    await box.fill('/');
    await box.dispatchEvent('input');
    await expect(page.locator('.slash-row').first()).toBeVisible({ timeout: 2 * 60_000 });
    await box.press('Escape');
    await box.fill('Посмотри @');
    await box.dispatchEvent('input');
    await expect(page.locator('.at-row').filter({ hasText: 'src/' }).first()).toBeVisible();
    await page.locator('.at-row').filter({ hasText: 'README.md' }).click();
    await expect(page.locator('.composer .chip')).toContainText('README.md');
    await app.close();
  });
}

test('claude-code: a question card, answered, stays as a summary line', async () => {
  test.skip(!agents.includes('claude-code'), 'Claude Code is not in SKARO_E2E_AGENTS');
  test.setTimeout(20 * 60_000);
  const { app, page, worktree } = await openCalc('claude-code', { permissionMode: 'full' });
  await send(
    page,
    'Задай мне вопрос через инструмент AskUserQuestion: какой цвет записать — красный или синий. ' +
      'Потом запиши выбранный цвет одним словом в color.txt.',
  );
  const question = card(page, 'Ответить');
  await expect(question).toBeVisible({ timeout: 10 * 60_000 });
  await question
    .locator('.option')
    .filter({ hasText: /[Сс]ин/ })
    .first()
    .click();
  await question.getByRole('button', { name: 'Ответить' }).click();
  await expect(page.locator('.fd-done-line').filter({ hasText: /Ответ/ })).toBeVisible();
  await waitTurnEnd(page, 1);
  expect(readFileSync(join(worktree, 'color.txt'), 'utf8').toLowerCase()).toMatch(/син|blue/);
  await app.close();
});

for (const agent of agents) {
  test(`${agent}: "Стоп" ends the running turn as stopped`, async () => {
    test.setTimeout(10 * 60_000);
    const { app, page } = await openCalc(agent, { permissionMode: 'full' });
    await send(
      page,
      'Выполни в терминале команду, которая ждёт 120 секунд (Start-Sleep -Seconds 120 или sleep 120), и только потом ответь.',
    );
    await waitForCommand(page, /sleep/i);
    await page.getByRole('button', { name: 'Остановить агента' }).click();
    await expect(page.locator('.fd-bar').filter({ hasText: 'Остановлено' })).toBeVisible({
      timeout: 60_000,
    });
    await app.close();
  });

  test(`${agent}: an image the agent looks at shows in the feed`, async () => {
    test.setTimeout(10 * 60_000);
    const { app, page, worktree } = await openCalc(agent, { permissionMode: 'full' });
    await send(page, 'Какого цвета картинка docs/logo.png? Посмотри её и ответь одним словом.');
    await waitTurnEnd(page, 1);
    expect(existsSync(join(worktree, 'docs', 'logo.png'))).toBe(true);
    await expect(page.locator('.fd-text').last()).toContainText(/красн|red/i);
    // The image is in the feed: in the "read" group or as its own row.
    const fold = page.locator('.fd-fold').filter({ hasText: /изображени/ });
    if (await fold.count()) await fold.first().click();
    const image = page.locator('img[src^="skaro-media://"]').first();
    await expect(image).toBeVisible();
    expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(48);
    await app.close();
  });
}
