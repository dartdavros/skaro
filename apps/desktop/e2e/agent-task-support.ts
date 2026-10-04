import { expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppDb } from '@skaro/core';
import { redSquare } from './image-test-support';
import { launchApp, tempUserData } from './launch';

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** A tiny project with two tasks: T-002 depends on T-001. */
export function makeRepo(root: string): string {
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

export async function openTask(page: Page, title: string): Promise<void> {
  await page.getByRole('navigation').getByText('Задачи').click();
  await page.getByRole('button', { name: new RegExp(title) }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

export async function send(page: Page, text: string): Promise<void> {
  const box = page.locator('.composer textarea');
  await box.fill(text);
  await box.press('Enter');
}

interface Setup {
  permissionMode: 'ask' | 'auto' | 'full';
  planFirst?: boolean;
}

/** A fresh app with the calc project open on T-001 and the agent settings given. */
export async function openCalc(agent: string, setup: Setup) {
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

export const card = (page: Page, text: string | RegExp) =>
  page.locator('.fd-card').filter({ hasText: text }).first();
