import { AppDb } from '@skaro/core';
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import type { SkaroApi } from '../src/shared/ipc';
import { makeRepo } from './agent-task-support';
import { launchApp, tempUserData } from './launch';

test('Codex rewinds a real chat and answers the edited message', async () => {
  test.skip(!process.env['SKARO_E2E_AGENTS']?.split(',').includes('codex'));
  test.setTimeout(5 * 60_000);
  const userData = tempUserData();
  const db = AppDb.open(join(userData, 'skaro.db'));
  const project = db.addProject({ name: 'Message edit', path: makeRepo(userData) });
  db.setOpenTabs([project.id], project.id);
  db.setSetting('ui.locale', 'ru');
  db.close();
  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    const chat = await page.evaluate(async (projectId) => {
      const api = (window as unknown as { skaro: SkaroApi }).skaro;
      return api.invoke(
        'chat.create',
        projectId,
        { agent: 'codex', effort: 'low', permissionMode: 'full' },
        {
          text: 'Ничего не меняй, не вызывай инструменты. Ответь только словом MESSAGE_BEFORE_EDIT.',
        },
      );
    }, project.id);
    await page.locator('.sessions .row').filter({ hasText: chat.title }).click();
    await expect(page.locator('.fd-text').filter({ hasText: 'MESSAGE_BEFORE_EDIT' })).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.locator('.composer .stop')).toHaveCount(0, { timeout: 120_000 });
    const user = page.locator('.fd-user').first();
    await user.hover();
    await user.getByRole('button', { name: 'Изменить', exact: true }).click();
    await user
      .locator('textarea')
      .fill('Ничего не меняй, не вызывай инструменты. Ответь только словом MESSAGE_AFTER_EDIT.');
    await user.getByRole('button', { name: 'Отправить', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Откатить и отправить', exact: true })
      .click();
    await expect(page.locator('.fd-text').filter({ hasText: 'MESSAGE_AFTER_EDIT' })).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.locator('.composer .stop')).toHaveCount(0, { timeout: 120_000 });
    await expect(page.locator('.fd-user')).toHaveCount(1);
    await expect(page.locator('.fd-user')).toContainText('MESSAGE_AFTER_EDIT');
    await expect(page.locator('.fd-text').filter({ hasText: 'MESSAGE_BEFORE_EDIT' })).toHaveCount(
      0,
    );
  } finally {
    await app.close();
  }
});
