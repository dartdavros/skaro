import { AppDb } from '@skaro/core';
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { chatScreenProject } from './chat-screen-support';
import { compareBaseline } from './layout-baseline';
import { launchApp, tempUserData } from './launch';

test('preserves saved chat navigation, archive, message actions and pinned plan', async () => {
  const userData = tempUserData();
  const fixture = chatScreenProject(userData);
  let app = await launchApp(userData);
  try {
    let page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    await page.evaluate(() => document.fonts.ready);
    const sessions = page.locator('.sessions');
    await expect(sessions.locator('.row')).toHaveCount(1);
    await expect(page.locator('.fd-text')).toContainText('A saved answer');
    await compareBaseline(sessions, process.env['SKARO_E2E_CHAT_LAYOUT'], 'active', true);
    const pinned = page.locator('.fd-pinned').filter({ hasText: 'saved-background' });
    await pinned.click();
    await expect(
      page.locator('.fd-output').filter({ hasText: 'Saved command output' }),
    ).toBeVisible();
    await pinned.press('Enter');
    await expect(
      page.locator('.fd-output').filter({ hasText: 'Saved command output' }),
    ).toHaveCount(0);
    const plan = page.locator('.plan').filter({ has: page.locator('button.head') });
    await compareBaseline(plan, process.env['SKARO_E2E_CHAT_LAYOUT'], 'plan-closed', true);
    await plan.getByRole('button').click();
    await expect(plan.locator('.step')).toHaveCount(3);
    await expect(plan.locator('.step.active')).toContainText('Working step');
    await page.mouse.move(5, 5);
    await compareBaseline(plan, process.env['SKARO_E2E_CHAT_LAYOUT'], 'plan-open', true);
    if (process.env['SKARO_E2E_CHAT_SCREENSHOT'])
      await page.screenshot({ path: process.env['SKARO_E2E_CHAT_SCREENSHOT'] });
    const user = page.locator('.fd-user').first();
    await user.hover();
    await expect(user.locator('.fd-hover-actions button')).toHaveCount(1);
    await expect(
      user.getByRole('button', { name: 'Скопировать сообщение', exact: true }),
    ).toBeVisible();
    await expect(user.locator('.fd-sent-at')).not.toBeEmpty();
    await expect(page.locator('.fd-user .import-source')).toHaveText('~/Docs/source · 2 файла');
    await page.getByRole('button', { name: 'Архивировать чат', exact: true }).click();
    await expect(sessions.locator('.row')).toHaveCount(0);
    await sessions.locator('.archive-toggle').click();
    await expect(sessions.locator('.row')).toHaveCount(2);
    await page.mouse.move(5, 5);
    await compareBaseline(sessions, process.env['SKARO_E2E_CHAT_LAYOUT'], 'archive', true);
    const archived = sessions.locator('.row').filter({ hasText: 'Archived history' });
    await archived.press('Enter');
    await expect(page.locator('.main > .head > .title')).toHaveText('Archived history');
    await archived.getByRole('button', { name: 'Вернуть из архива', exact: true }).click();
    await expect(sessions.locator('.row')).toHaveCount(1);
    await sessions.locator('.archive-toggle').click();
    await expect(sessions.locator('.row')).toContainText('Archived history');
    const db = AppDb.open(join(userData, 'skaro.db'));
    expect(db.getChat(fixture.active.id)?.archived).toBe(true);
    expect(db.getChat(fixture.archived.id)?.archived).toBe(false);
    db.close();
    await sessions.getByRole('button', { name: 'Новый чат', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Импортировать документацию', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
    await app.close();
    app = await launchApp(userData);
    page = await app.firstWindow();
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    await expect(page.locator('.sessions .row')).toContainText('Archived history');
    await expect(page.locator('.main > .head > .title')).toHaveText('Archived history');
  } finally {
    await app.close();
  }
});
