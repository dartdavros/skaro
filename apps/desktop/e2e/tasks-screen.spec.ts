import { expect, test } from '@playwright/test';
import { utimesSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, tempUserData } from './launch';
import { planProject } from './plan-test-support';
import { compareBaseline } from './layout-baseline';

test('preserves task board/list, filters, selection and native bulk actions', async () => {
  const userData = tempUserData();
  const store = await planProject(userData);
  await store.updateTask('T-003', { dependsOn: ['T-002'] });
  for (const item of (await store.load()).tasks) {
    const date = new Date('2026-10-01T08:00:00Z');
    utimesSync(join(store.root, item.path), date, date);
  }
  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const screen = page.locator('.screen').filter({ has: page.locator('.board, .list') });
    const compare = (name: string) =>
      compareBaseline(screen, process.env['SKARO_E2E_TASKS_LAYOUT'], name, true);
    const dialog = page.getByRole('dialog');
    const compareDialog = (name: string) =>
      compareBaseline(dialog, process.env['SKARO_E2E_TASKS_LAYOUT'], name, true);
    const row = (id: string) =>
      screen.locator('.grid.row').filter({ has: page.locator('.id', { hasText: id }) });
    const select = async (id: string) => row(id).getByRole('checkbox').click();
    const action = (tip: string) => screen.locator(`button[data-tip="${tip}"]`);
    await expect(screen.locator('.card')).toHaveCount(3);
    await compare('board');
    await screen.getByRole('button', { name: 'Список', exact: true }).click();
    await expect(screen.locator('.grid.row')).toHaveCount(3);
    await compare('list');
    if (process.env['SKARO_E2E_TASKS_SCREENSHOT']) {
      await page.screenshot({ path: process.env['SKARO_E2E_TASKS_SCREENSHOT'] });
    }
    const search = screen.getByPlaceholder('Поиск по названию и ID');
    await search.fill('T-002');
    await expect(screen.locator('.grid.row')).toHaveCount(1);
    await search.fill('');
    await screen.getByRole('button', { name: 'Статус', exact: true }).click();
    await page.getByRole('menuitemcheckbox').filter({ hasText: 'Готово' }).click();
    await page.keyboard.press('Escape');
    await expect(screen.locator('.grid.row')).toHaveCount(1);
    await compare('filtered');
    await screen.getByRole('button', { name: 'Сбросить', exact: true }).click();
    await select('T-002');
    await select('T-003');
    await compare('selected');
    await action('Назначить агента').click();
    await dialog.getByRole('radio').filter({ hasText: 'Codex' }).click();
    await expect(
      dialog.getByRole('button', { name: 'Модель', exact: true }).locator('.value'),
    ).not.toBeEmpty();
    await compareDialog('assign');
    await dialog.getByRole('button', { name: 'Назначить', exact: true }).click();
    await expect(row('T-002').locator('.agent-name')).toContainText('Codex');
    await expect(row('T-003').locator('.agent-name')).toContainText('Codex');
    await page.reload();
    await expect(row('T-002').locator('.agent-name')).toContainText('Codex');
    await expect(row('T-003').locator('.agent-name')).toContainText('Codex');
    await select('T-002');
    await select('T-003');
    await screen.getByRole('button', { name: 'Запустить', exact: true }).click();
    await expect(dialog).toContainText('Запустить задачи');
    await dialog.getByRole('button', { name: 'Как в задаче', exact: true }).click();
    await expect(dialog.locator('.static')).toHaveText('Как в задаче');
    await compareDialog('run');
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    await action('Разблокировать').click();
    await expect(dialog.locator('.tasks .task')).toHaveCount(1);
    await compareDialog('unblock');
    await dialog.getByRole('button', { name: 'Разблокировать', exact: true }).click();
    await expect.poll(async () => (await store.readTask('T-003')).unblocked).toBe(true);
    await action('Перенести в этап').click();
    await compareDialog('move');
    await dialog.getByRole('radio').filter({ hasText: 'Empty milestone' }).click();
    await dialog.locator('button.confirm').click();
    await expect.poll(async () => (await store.readTask('T-002')).milestone).toBe('M03');
    await action('Архивировать — уйдёт с доски, история сохранится').click();
    await compareDialog('archive');
    await dialog.locator('button.confirm').click();
    await expect(screen.locator('.grid.row')).toHaveCount(1);
    await expect.poll(async () => (await store.readTask('T-002')).archived).toBe(true);
    await select('T-001');
    await action('Удалить безвозвратно').click();
    await compareDialog('delete');
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(screen.locator('.grid.row')).toHaveCount(1);
    await action('Удалить безвозвратно').click();
    await dialog.locator('button.confirm').click();
    await expect(page.locator('.screen .empty-title')).toBeVisible();
    await compareBaseline(
      page.locator('.screen').filter({ has: page.locator('.empty-title') }),
      process.env['SKARO_E2E_TASKS_LAYOUT'],
      'empty',
      true,
    );
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
