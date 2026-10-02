import { AppDb } from '@skaro/core';
import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './agent-task-support';
import { compareBaseline } from './layout-baseline';
import { launchApp, tempUserData } from './launch';
import { planProject } from './plan-test-support';
import type { SkaroApi } from '../src/shared/ipc';

test('preserves project creation and creates a real Git repository', async () => {
  const userData = tempUserData();
  await planProject(userData);
  const parent = join(userData, 'projects');
  mkdirSync(parent);
  const db = AppDb.open(join(userData, 'skaro.db'));
  db.setSetting('projects.parent', parent);
  db.close();
  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('button', { name: 'Открыть проект', exact: true }).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByRole('button', { name: 'Подключить', exact: true })).toBeDisabled();
    await compareBaseline(modal, process.env['SKARO_E2E_MODALS_LAYOUT'], 'existing', true);
    await modal.getByRole('button').filter({ hasText: 'Новая папка' }).click();
    await expect(modal.locator('.path')).toHaveText(parent);
    await expect(modal.getByRole('button', { name: 'Создать проект', exact: true })).toBeDisabled();
    await compareBaseline(modal, process.env['SKARO_E2E_MODALS_LAYOUT'], 'create', true);
    if (process.env['SKARO_E2E_MODALS_SCREENSHOT'])
      await page.screenshot({ path: `${process.env['SKARO_E2E_MODALS_SCREENSHOT']}-create.png` });
    const name = modal.getByPlaceholder('shop-api');
    await name.fill('..');
    await modal.getByRole('button', { name: 'Создать проект', exact: true }).click();
    await expect(modal.locator('.info.error')).toHaveText('invalid project name');
    await compareBaseline(modal, process.env['SKARO_E2E_MODALS_LAYOUT'], 'invalid', true);
    await name.fill('Created project');
    await name.press('Enter');
    await expect(modal).toHaveCount(0);
    await expect(page.locator('header.bar')).toContainText('Created project');
    const root = join(parent, 'Created project');
    expect(existsSync(join(root, '.skaro/config.yaml'))).toBe(true);
    expect(git(root, 'branch', '--show-current')).toBe('main');
    expect(git(root, 'rev-list', '--count', 'HEAD')).toBe('1');
  } finally {
    await app.close();
  }
});

test('preserves native file drops, source validation and import agent settings', async () => {
  const userData = tempUserData();
  await planProject(userData);
  const db = AppDb.open(join(userData, 'skaro.db'));
  const projectId = db.listProjects()[0]!.id;
  db.close();
  const sourcePath = join(userData, 'source.md');
  const unsupported = join(userData, 'drawing.vsdx');
  const missing = join(userData, 'missing.md');
  writeFileSync(sourcePath, '# Source\n\nA real document.\n');
  writeFileSync(unsupported, 'Unsupported format.\n');
  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    await page.evaluate(() => document.fonts.ready);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    if (!process.env['SKARO_E2E_COLD_CATALOG'])
      await page.evaluate(async (projectId) => {
        const api = (window as unknown as { skaro: SkaroApi }).skaro;
        await Promise.allSettled([
          api.invoke('agents.models', 'codex', projectId),
          api.invoke('agents.models', 'claude-code', projectId),
        ]);
      }, projectId);
    await page.getByRole('button', { name: 'Импортировать документацию', exact: true }).click();
    const modal = page.getByRole('dialog').first();
    await modal.locator('.agent-btn').click();
    const agent = page.getByRole('dialog').last();
    await agent.locator('button.agent').filter({ hasText: 'Codex' }).click();
    await expect(
      agent.getByRole('button', { name: 'Модель', exact: true }).locator('.value'),
    ).not.toBeEmpty({ timeout: 15_000 });
    const modelName = await agent
      .getByRole('button', { name: 'Модель', exact: true })
      .locator('.value')
      .innerText();
    await agent.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(modal.locator('.agent-btn')).toContainText(modelName);
    const start = modal.getByRole('button', { name: 'Начать импорт', exact: true });
    const compare = async (name: string) => {
      await page.mouse.move(5, 5);
      await page.evaluate(() => document.fonts.ready);
      await expect(modal.locator('.agent-btn')).toContainText(modelName);
      await compareBaseline(modal, process.env['SKARO_E2E_MODALS_LAYOUT'], name, true);
    };
    await expect(start).toBeDisabled();
    await compare('import-empty');
    const cdp = await page.context().newCDPSession(page);
    const drop = async (...files: string[]) => {
      const bounds = (await modal.locator('.drop').boundingBox())!;
      const data = { items: [], files, dragOperationsMask: 1 };
      const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, data };
      for (const type of ['dragEnter', 'dragOver', 'drop'] as const)
        await cdp.send('Input.dispatchDragEvent', { type, ...point });
    };
    await drop(unsupported);
    await expect(modal.locator('.source')).toHaveCount(1);
    await expect(modal).toContainText('Нечего импортировать');
    await expect(start).toBeDisabled();
    await compare('unsupported');
    await modal.getByRole('button', { name: 'Убрать', exact: true }).click();
    await drop(sourcePath);
    await expect(modal.locator('.source')).toHaveCount(1);
    await expect(start).toBeEnabled();
    await compare('source');
    if (process.env['SKARO_E2E_MODALS_SCREENSHOT'])
      await page.screenshot({ path: `${process.env['SKARO_E2E_MODALS_SCREENSHOT']}-import.png` });
    await drop(sourcePath);
    await expect(modal.locator('.source')).toHaveCount(1);
    rmSync(sourcePath);
    await start.click();
    await expect(modal.getByRole('alert')).toContainText('is not available');
    await compare('import-error');
    await modal.getByRole('button', { name: 'Убрать', exact: true }).click();
    await drop(missing);
    await expect(modal.locator('.source.broken')).toHaveCount(1);
    await expect(modal.getByRole('alert')).toContainText('Источник недоступен.');
    await expect(start).toBeDisabled();
    await compare('missing');
    await modal.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await cdp.detach();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
