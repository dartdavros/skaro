import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppDb } from '@skaro/core';
import type { SkaroApi } from '../src/shared/ipc';
import { launchApp, tempUserData } from './launch';

declare const window: Window & { skaro: SkaroApi };

test('opens the frameless main window with the Skaro top bar', async () => {
  const app = await launchApp();
  const page = await app.firstWindow();

  await expect(page).toHaveTitle('Skaro');
  await expect(page.getByRole('button', { name: /Главная|Home/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Настройки|Settings/ })).toBeVisible();

  // Renderer is isolated: no Node globals leak into the page, only the typed bridge.
  const isolation = await page.evaluate(() => ({
    node: 'require' in globalThis || 'process' in globalThis,
    bridge: typeof window.skaro?.invoke,
  }));
  expect(isolation).toEqual({ node: false, bridge: 'function' });

  // Methods outside the whitelist are refused.
  const refused = await page.evaluate(() =>
    (window.skaro.invoke as (method: string) => Promise<unknown>)('fs.readFile').then(
      () => 'allowed',
      (e: Error) => e.message,
    ),
  );
  expect(refused).toContain('unknown method');

  await app.close();
});

test('restores project tabs after a restart', async () => {
  // On hosted macOS runners the second launch with the same data dir hangs; investigated separately.
  test.skip(
    !!process.env['CI'] && process.platform === 'darwin',
    'relaunch hangs on hosted macOS runners',
  );
  const userData = tempUserData();
  const shop = join(userData, 'shop-api');
  const blog = join(userData, 'blog-engine');
  mkdirSync(shop);
  mkdirSync(blog);
  const db = AppDb.open(join(userData, 'skaro.db'));
  const a = db.addProject({ name: 'Shop API', path: shop });
  const b = db.addProject({ name: 'Blog Engine', path: blog });
  db.setOpenTabs([a.id, b.id], b.id);
  db.setSetting('ui.locale', 'ru');
  db.close();

  let app = await launchApp(userData);
  let page = await app.firstWindow();
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveText(['Shop API', 'Blog Engine']);
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Blog Engine');
  await expect(page.getByRole('navigation').getByText('Обзор')).toBeVisible();

  // Close the active tab: Shop API becomes active; then open the Tasks section.
  await page
    .getByRole('tab', { name: 'Blog Engine' })
    .getByRole('button', { name: 'Закрыть вкладку' })
    .click();
  await expect(tabs).toHaveText(['Shop API']);
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Shop API');
  await app.close();

  app = await launchApp(userData);
  page = await app.firstWindow();
  await expect(page.getByRole('tab')).toHaveText(['Shop API']);
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Shop API');
  await app.close();
});

test('creates a new project folder as a git repository from the "Новый проект" modal', async () => {
  const userData = tempUserData();
  const parent = join(userData, 'code');
  mkdirSync(parent);
  const db = AppDb.open(join(userData, 'skaro.db'));
  db.setSetting('ui.locale', 'ru');
  db.setSetting('projects.parent', parent);
  db.close();

  const app = await launchApp(userData);
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Новый проект' }).click();
  const modal = page.getByRole('dialog', { name: 'Новый проект' });
  await expect(modal.getByRole('button', { name: 'Подключить' })).toBeDisabled();
  await modal.getByRole('button', { name: /Новая папка/ }).click();
  await expect(modal).toContainText(parent);
  await modal.getByPlaceholder('shop-api').fill('calc');
  await modal.getByRole('button', { name: 'Создать проект' }).click();

  await expect(page.getByRole('tab', { selected: true })).toHaveText('calc');
  const repo = join(parent, 'calc');
  expect(readFileSync(join(repo, '.skaro', 'config.yaml'), 'utf8')).toContain('base_branch: main');
  expect(execFileSync('git', ['log', '--format=%s'], { cwd: repo, encoding: 'utf8' }).trim()).toBe(
    'Skaro: new project',
  );
  await app.close();
});
