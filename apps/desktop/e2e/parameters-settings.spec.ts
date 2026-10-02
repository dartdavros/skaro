import { AppDb } from '@skaro/core';
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { agentDefaultsKey } from '../src/shared/ipc';
import { compareBaseline } from './layout-baseline';
import { launchApp, tempUserData } from './launch';
import { planProject } from './plan-test-support';

test('preserves project parameters and saves real agent defaults', async () => {
  const userData = tempUserData();
  const store = await planProject(userData);
  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('navigation').getByText('Параметры', { exact: true }).click();
    const params = page.locator('.screen').filter({ has: page.locator('.cards .remove') });
    await params.getByRole('radio').filter({ hasText: 'Codex' }).click();
    const projectModel = params.getByRole('button', { name: 'Модель', exact: true });
    await expect(projectModel.locator('.value')).not.toBeEmpty({ timeout: 15_000 });
    await compareBaseline(params, process.env['SKARO_E2E_PARAMETERS_LAYOUT'], 'project', true);
    if (process.env['SKARO_E2E_PARAMETERS_SCREENSHOT']) {
      await page.screenshot({
        path: `${process.env['SKARO_E2E_PARAMETERS_SCREENSHOT']}-project.png`,
      });
    }
    const name = params.getByLabel('Название', { exact: true });
    await name.fill('Renamed project');
    await name.press('Enter');
    await expect(page.locator('header.bar')).toContainText('Renamed project');
    await params.getByLabel('Базовая ветка', { exact: true }).fill('develop');
    await params.getByLabel('Базовая ветка', { exact: true }).press('Tab');
    await expect.poll(async () => (await store.load()).config.baseBranch).toBe('develop');
    await params.getByRole('radio', { name: 'Merge', exact: true }).click();
    await expect.poll(async () => (await store.load()).config.merge.strategy).toBe('merge');
    await params.getByRole('radio', { name: 'Текущая папка', exact: true }).click();
    await expect.poll(async () => (await store.load()).config.isolation).toBe('in-place');
    await params.getByRole('radio').filter({ hasText: 'Авто в пределах задачи' }).click();
    await expect.poll(async () => (await store.load()).config.permissionMode).toBe('auto');
    const autoDocs = !(await store.load()).config.chat.autoAcceptDocs;
    await params.getByRole('switch', { name: 'Применять документы автоматически' }).click();
    await expect.poll(async () => (await store.load()).config.chat.autoAcceptDocs).toBe(autoDocs);
    const instructions = params.locator('textarea');
    await instructions.fill('Keep changes small.');
    await instructions.press('Tab');
    await expect
      .poll(async () => (await store.load()).config.agentInstructions)
      .toBe('Keep changes small.');
    await compareBaseline(params, process.env['SKARO_E2E_PARAMETERS_LAYOUT'], 'changed', true);
    await page.reload();
    await page.getByRole('navigation').getByText('Параметры', { exact: true }).click();
    await expect(params.getByLabel('Название', { exact: true })).toHaveValue('Renamed project');
    await expect(params.getByLabel('Базовая ветка', { exact: true })).toHaveValue('develop');
    await expect(instructions).toHaveValue('Keep changes small.');
    await page.locator('button[data-tip="Настройки"]').click();
    const settings = page.locator('.settings');
    const codex = settings
      .locator('.agent.set-card')
      .filter({ has: page.locator('.name', { hasText: 'Codex' }) });
    await expect(settings.locator('.cfg-counts')).toHaveCount(2, { timeout: 20_000 });
    await expect(
      codex.getByRole('button', { name: 'Модель по умолчанию', exact: true }).locator('.value'),
    ).not.toBeEmpty();
    await compareBaseline(
      settings.locator('.set-section').filter({ has: page.locator('.agent.set-card') }),
      process.env['SKARO_E2E_PARAMETERS_LAYOUT'],
      'agents',
      true,
    );
    if (process.env['SKARO_E2E_PARAMETERS_SCREENSHOT']) {
      await page.screenshot({
        path: `${process.env['SKARO_E2E_PARAMETERS_SCREENSHOT']}-agents.png`,
      });
    }
    await codex.getByRole('button', { name: 'Модель по умолчанию', exact: true }).click();
    await page.getByRole('option').first().click();
    const readDefault = () => {
      const db = AppDb.open(join(userData, 'skaro.db'));
      try {
        return db.getSetting<{ model?: string; effort?: string } | null>(
          agentDefaultsKey('codex'),
          null,
        );
      } finally {
        db.close();
      }
    };
    await expect.poll(() => readDefault()?.model).toBeTruthy();
    await codex.getByRole('slider').press('ArrowLeft');
    await expect.poll(() => readDefault()?.effort).toBeTruthy();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
