// Opt-in verification against actual task history, using the real Electron app and backend.
import { expect, test, type Page } from '@playwright/test';
import { feedRows, groupFeedRows } from '@skaro/timeline';
import type { SkaroApi } from '../src/shared/ipc';
import { launchApp } from './launch';

declare const window: Window & { skaro: SkaroApi };
const userData = process.env['SKARO_FEED_USER_DATA'];
const projectId = process.env['SKARO_FEED_PROJECT_ID'];
const taskId = process.env['SKARO_FEED_TASK_ID'];
test.skip(
  !userData || !projectId || !taskId,
  'Requires an isolated snapshot of actual task history',
);

async function openTask(page: Page, title: string): Promise<void> {
  await page.locator('.project-nav').getByRole('button', { name: 'Задачи' }).click();
  await page
    .locator('.board .card')
    .filter({ has: page.locator('.title', { hasText: title }) })
    .click();
  await expect(page.locator('.fd-feed')).toBeVisible();
}

// Electron supplies its own page; the empty fixture pattern is required to receive testInfo.
// eslint-disable-next-line no-empty-pattern
test('actions and command output stay folded until opened by the user, including input waits', async ({}, testInfo) => {
  const app = await launchApp(userData!);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.hide();
      window.setSize(1412, 982);
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.evaluate(async (projectId) => {
      await window.skaro.invoke('tabs.set', { projects: [projectId], active: projectId });
      await window.skaro.invoke('app.setSetting', 'ui.locale', 'ru');
      await window.skaro.invoke('app.setSetting', 'ui.navCollapsed', false);
      await window.skaro.invoke('app.setSetting', `tasks.${projectId}.view`, 'board');
    }, projectId!);
    await page.reload();
    await page.locator('.project-nav').getByRole('button', { name: 'Задачи' }).click();
    const view = await page.evaluate(
      ({ projectId, taskId }) => window.skaro.invoke('task.open', projectId, taskId),
      { projectId: projectId!, taskId: taskId! },
    );
    expect(view.timeline, 'The actual task must have recorded history').toBeDefined();
    const block = groupFeedRows(feedRows(view.timeline!)).find(
      (block) =>
        block.type === 'actions' &&
        block.rows.some(
          (row) => row.type === 'command' && row.item.awaitingInput && row.item.output.trim(),
        ),
    );
    expect(block?.type, 'Actual history must include a command marked as awaiting input').toBe(
      'actions',
    );
    if (block?.type !== 'actions') throw new Error('Missing input-wait action group');
    const command = block.rows.find(
      (row) => row.type === 'command' && row.item.awaitingInput && row.item.output.trim(),
    );
    if (command?.type !== 'command') throw new Error('Missing recorded command');
    await openTask(page, view.task.title);
    await expect(page.locator('[data-action-group] > button[aria-expanded="true"]')).toHaveCount(0);
    await expect(page.locator('[data-action-group] .fd-sublist')).toHaveCount(0);

    const header = page.locator(`button[aria-controls=${JSON.stringify(`${block.id}-list`)}]`);
    const group = header.locator('..');
    await header.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('actions-folded.png') });
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    const row = group
      .locator('.fd-row-wrap')
      .filter({ has: page.locator('.fd-main', { hasText: command.item.command }) })
      .filter({ hasText: 'ждёт ввода' })
      .first();
    const commandBlock = row.locator('..');
    await expect(row).toBeVisible();
    await expect(group.locator('.fd-output')).toHaveCount(0);
    await row.click();
    await expect(commandBlock.locator('.fd-output')).toBeVisible();
    await expect(commandBlock.locator('.input-note')).toContainText('Команда ждёт ввода');
    await page.screenshot({ path: testInfo.outputPath('command-opened-by-user.png') });
    await row.click();
    await expect(commandBlock.locator('.fd-expanded')).toHaveCount(0);
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await header.click();
    await expect(group.locator('.fd-output')).toHaveCount(0);
    await row.focus();
    await row.press('Enter');
    await expect(commandBlock.locator('.fd-output')).toBeVisible();
    await row.press('Enter');
    await expect(commandBlock.locator('.fd-expanded')).toHaveCount(0);
    await header.click();
    await page.reload();
    await openTask(page, view.task.title);
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-action-group] .fd-sublist')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
