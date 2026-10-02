import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, tempUserData } from './launch';
import { architecture, docsProject } from './docs-test-support';
import { compareBaseline } from './layout-baseline';

test('preserves document reading, tree, editing, conflicts and ADR/specification actions', async () => {
  const userData = tempUserData();
  const store = await docsProject(userData);
  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('navigation').getByText('Документы', { exact: true }).click();
    const screen = page.locator('.screen').filter({ has: page.locator('.tree') });
    const tree = page.getByRole('tree');
    const compare = (name: string) =>
      compareBaseline(screen, process.env['SKARO_E2E_DOCS_LAYOUT'], name, true);
    await expect(page.getByRole('heading', { name: 'Архитектура', exact: true })).toBeVisible();
    await expect(page.locator('.blocks .code')).toContainText('export const example = 1;');
    await expect(page.locator('.rules')).toContainText('Keep modules small.');
    await compare('reading');
    if (process.env['SKARO_E2E_DOCS_SCREENSHOT']) {
      await page.screenshot({ path: process.env['SKARO_E2E_DOCS_SCREENSHOT'] });
    }
    await page.locator('.code .copy').click();
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('export const example = 1;');
    await page.getByRole('button', { name: 'На странице', exact: true }).click();
    await expect(page.locator('.page nav')).toHaveCount(0);
    await page.getByRole('button', { name: 'На странице', exact: true }).click();
    await page.locator('.toc-item').filter({ hasText: 'Example' }).click();
    await expect(page.locator('.toc-item.on')).toHaveText('Example');
    const resize = page.locator('.tree > .resize');
    const bounds = (await resize.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 30);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 30, bounds.y + 30, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('.tree')).toHaveCSS('width', '286px');
    await page.locator('.tree .hide').click();
    await expect(tree).toHaveCount(0);
    await page.locator('.show-tree').click();
    await expect(tree).toBeVisible();
    await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
    const area = page.locator('.editor textarea');
    await expect(area).toHaveValue(architecture);
    await compare('editing');
    await area.fill('Draft to discard');
    await tree.getByRole('treeitem').filter({ hasText: 'Бриф' }).click();
    const leave = page.getByRole('alertdialog');
    await expect(leave).toContainText('Отменить изменения?');
    await compareBaseline(leave, process.env['SKARO_E2E_DOCS_LAYOUT'], 'leave', true);
    await leave.getByRole('button', { name: 'Продолжить правку', exact: true }).click();
    await expect(area).toHaveValue('Draft to discard');
    await tree.getByRole('treeitem').filter({ hasText: 'Бриф' }).click();
    await leave.getByRole('button', { name: 'Отменить правки', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Бриф', exact: true })).toBeVisible();
    await tree.getByRole('treeitem').filter({ hasText: 'Архитектура' }).click();
    await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
    await area.fill('## Edited title\n\nEdited body.\n');
    await page.getByRole('button', { name: 'Просмотр', exact: true }).click();
    await expect(area).toHaveCount(0);
    await expect(page.locator('.blocks')).toContainText('Edited body.');
    await page.getByRole('button', { name: 'Рядом', exact: true }).click();
    await expect(area).toHaveValue('## Edited title\n\nEdited body.\n');
    await store.writeDoc('architecture.md', '## External title\n\nExternal body.\n');
    await expect(page.locator('.conflict')).toContainText('Файл изменился на диске.');
    await compare('conflict');
    await page.getByRole('button', { name: 'Оставить мою версию', exact: true }).click();
    await area.press('Control+s');
    await expect(area).toHaveCount(0);
    await expect
      .poll(() => readFileSync(join(store.root, '.skaro/architecture.md'), 'utf8'))
      .toContain('Edited body.');
    await tree.getByRole('treeitem').filter({ hasText: 'Module decision' }).click();
    await expect(page.getByRole('heading', { name: 'Module decision', exact: true })).toBeVisible();
    await compare('adr');
    await page.locator('.header .status').click();
    await page.getByRole('menuitemradio', { name: 'Принят', exact: true }).click();
    await expect.poll(async () => (await store.load()).adrs[0]?.status).toBe('accepted');
    await tree.getByRole('treeitem').filter({ hasText: 'Calculation specification' }).click();
    await expect(page.locator('.spec-tasks')).toContainText('1 из 1 готово');
    await compare('spec');
    await page.locator('.tree .new').click();
    await page.getByRole('menuitem', { name: 'Новый документ', exact: true }).click();
    const modal = page.getByRole('dialog');
    await modal.getByPlaceholder('delivery-notes').fill('created-note');
    await modal.getByRole('button', { name: 'Создать', exact: true }).click();
    await expect(area).toHaveValue('## ');
    await area.fill('## Created note\n\nCreated body.\n');
    await area.press('Control+s');
    await expect
      .poll(() => readFileSync(join(store.root, '.skaro/docs/created-note.md'), 'utf8'))
      .toContain('Created body.');
    await tree.getByRole('treeitem').filter({ hasText: 'Calculation specification' }).click();
    await page.locator('.spec-task').click();
    await expect(
      page.getByRole('heading', { name: 'Исправить сложение', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
