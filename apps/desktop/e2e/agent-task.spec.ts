// Stage 5 end to end: a task with a real agent goes through the whole cycle — run in a worktree,
// "Вливай" in the task chat, merge_task, the confirmation card, the merge, the dependent task
// unblocked — and the feed comes back after a restart.
//
// Needs signed-in agents and spends a little of their usage, so it runs only on request:
//   SKARO_E2E_AGENTS=claude-code,codex SKARO_AGENTS_DIR=<shared agents dir> pnpm test:e2e agent-task

import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
