// Stage 5 end to end: a task with a real agent goes through the whole cycle — run in a worktree,
// "Вливай" in the task chat, merge_task, the confirmation card, the merge, the dependent task
// unblocked — and the feed comes back after a restart.
//
// Needs signed-in agents and spends a little of their usage, so it runs only on request:
//   SKARO_E2E_AGENTS=claude-code,codex SKARO_AGENTS_DIR=<shared agents dir> pnpm test:e2e agent-task

import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { AppDb } from '@skaro/core';
import { launchApp, tempUserData } from './launch';

const agents = (process.env['SKARO_E2E_AGENTS'] ?? '').split(',').filter(Boolean);

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** A tiny project with two tasks: T-002 depends on T-001. */
function makeRepo(root: string): string {
  const repo = join(root, 'calc');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, '.skaro', 'tasks'), { recursive: true });
  writeFileSync(join(repo, 'src', 'math.js'), 'export const add = (a, b) => a - b;\n');
  writeFileSync(join(repo, 'README.md'), '# calc\n');
  mkdirSync(join(repo, 'docs'));
  writeFileSync(join(repo, 'docs', 'logo.png'), redSquare());
  writeFileSync(join(repo, '.skaro', 'config.yaml'), 'base_branch: main\n');
  writeFileSync(
    join(repo, '.skaro', 'tasks', 'T-001-fix-add.md'),
    '---\nid: T-001\ntitle: Исправить сложение\nstatus: todo\ndepends_on: []\n---\n' +
      '## Цель\n\nФункция add в src/math.js вычитает вместо сложения. Исправь её.\n\n' +
      '## Критерии приёмки\n\n- add(2, 3) возвращает 5\n',
  );
  writeFileSync(
    join(repo, '.skaro', 'tasks', 'T-002-mul.md'),
    '---\nid: T-002\ntitle: Добавить умножение\nstatus: todo\ndepends_on: [T-001]\n---\n' +
      '## Цель\n\nДобавь в src/math.js функцию mul(a, b), которая возвращает произведение.\n\n' +
      '## Критерии приёмки\n\n- mul(2, 3) возвращает 6\n',
  );
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'Skaro E2E');
  git(repo, 'config', 'user.email', 'e2e@skaro.dev');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  return repo;
}

async function openTask(page: Page, title: string): Promise<void> {
  await page.getByRole('navigation').getByText('Задачи').click();
  await page.getByRole('button', { name: new RegExp(title) }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

/** Waits until the agent is idle after a turn: the summary line of the latest turn. */
async function waitTurnEnd(page: Page, count: number): Promise<void> {
  await expect(page.locator('.fd-bar')).toHaveCount(count, { timeout: 10 * 60_000 });
  await expect(page.locator('.fd-bar').last()).not.toHaveClass(/error/);
}

async function send(page: Page, text: string): Promise<void> {
  const box = page.locator('.composer textarea');
  await box.fill(text);
  await box.press('Enter');
}

for (const agent of agents) {
  test(`${agent}: task runs, merges from the task chat and survives a restart`, async () => {
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

    // The main branch has the fix and the task file says done; the worktree is gone.
    expect(readFileSync(join(repo, 'src', 'math.js'), 'utf8')).toContain('a + b');
    expect(readFileSync(join(repo, '.skaro', 'tasks', 'T-001-fix-add.md'), 'utf8')).toContain(
      'status: done',
    );
    expect(git(repo, 'status', '--porcelain', '--untracked-files=no', '--', 'src')).toBe('');
    // The worktree goes away once the agent has finished its reply.
    await expect
      .poll(() => git(repo, 'worktree', 'list'), { timeout: 5 * 60_000 })
      .not.toContain(taskId);
    await expect(page.locator('.chip').filter({ hasText: 'Готово' })).toBeVisible();

    // T-002 is no longer blocked.
    await page.getByRole('button', { name: 'Задачи', exact: true }).first().click();
    await expect(
      page.getByRole('button', { name: /Добавить умножение/ }).locator('.chip'),
    ).toHaveText(/Не начата/);
    await app.close();

    // After a restart the feed of T-001 is rebuilt from its raw log.
    app = await launchApp(userData);
    page = await app.firstWindow();
    await openTask(page, 'Исправить сложение');
    await expect(page.locator('.fd-user')).toHaveCount(2);
    await expect(page.getByText('Влито в main')).toBeVisible();
    await app.close();
  });
}

interface Setup {
  permissionMode: 'ask' | 'auto' | 'full';
  planFirst?: boolean;
}

/** A fresh app with the calc project open on T-001 and the agent settings given. */
async function openCalc(agent: string, setup: Setup) {
  const userData = tempUserData();
  const repo = makeRepo(userData);
  const db = AppDb.open(join(userData, 'skaro.db'));
  const project = db.addProject({ name: 'Calc', path: repo });
  db.setOpenTabs([project.id], project.id);
  db.setSetting('ui.locale', 'ru');
  db.setSetting(`task.${project.id}.T-001.agent`, {
    agent,
    effort: 'low',
    permissionMode: setup.permissionMode,
    planFirst: setup.planFirst ?? false,
    isolation: 'worktree',
  });
  db.close();
  const app = await launchApp(userData);
  const page = await app.firstWindow();
  await openTask(page, 'Исправить сложение');
  const worktree = join(userData, 'worktrees', project.id, 'T-001');
  return { app, page, worktree };
}

const card = (page: Page, text: string | RegExp) =>
  page.locator('.fd-card').filter({ hasText: text }).first();

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
    .locator('.fd-option')
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
  test(`${agent}: rewind to a message takes the files and the feed back`, async () => {
    test.setTimeout(20 * 60_000);
    const { app, page, worktree } = await openCalc(agent, { permissionMode: 'full' });
    await send(page, 'Создай файл one.txt с текстом 1. Больше ничего не делай.');
    await waitTurnEnd(page, 1);
    await send(page, 'Создай файл two.txt с текстом 2. Больше ничего не делай.');
    await waitTurnEnd(page, 2);
    expect(readFileSync(join(worktree, 'two.txt'), 'utf8').trim()).toBe('2');

    const second = page.locator('.fd-user').nth(1);
    await second.hover();
    await second.getByRole('button', { name: 'Откатить к этому сообщению' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Откатить', exact: true })
      .click();
    await expect(page.locator('.fd-user')).toHaveCount(1, { timeout: 2 * 60_000 });
    await expect.poll(() => existsSync(join(worktree, 'two.txt')), { timeout: 60_000 }).toBe(false);
    expect(existsSync(join(worktree, 'one.txt'))).toBe(true);
    await app.close();
  });
}

/** A 48×48 red PNG. */
function redSquare(): Buffer {
  const size = 48;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) raw.set([230, 40, 40], y * (size * 3 + 1) + 1 + x * 3);
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(data: Buffer): number {
  let c = ~0;
  for (const byte of data) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

for (const agent of agents) {
  test(`${agent}: "Стоп" ends the running turn as stopped`, async () => {
    test.setTimeout(10 * 60_000);
    const { app, page } = await openCalc(agent, { permissionMode: 'full' });
    await send(
      page,
      'Выполни в терминале команду, которая ждёт 120 секунд (Start-Sleep -Seconds 120 или sleep 120), и только потом ответь.',
    );
    await expect(page.locator('.fd-row').filter({ hasText: /sleep/i }).first()).toBeVisible({
      timeout: 5 * 60_000,
    });
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
