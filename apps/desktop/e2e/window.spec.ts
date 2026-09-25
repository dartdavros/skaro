import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
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
