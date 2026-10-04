// Read-only UI check on a snapshot of actual projects and recorded agent histories.
import { expect, test, type Locator } from '@playwright/test';
import { join } from 'node:path';
import { launchApp } from './launch';
import type { SkaroApi } from '../src/shared/ipc';

const profile = process.env['SKARO_E2E_LIVE_PROFILE'];
const projectId = process.env['SKARO_E2E_SCROLL_PROJECT'];
const taskId = process.env['SKARO_E2E_SCROLL_TASK'];
test.skip(!profile || !projectId || !taskId, 'Requires actual saved task history');

async function distance(scroller: Locator): Promise<number> {
  return scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
}

test('opens task history at the end, preserves reading older messages and resets on reentry', async () => {
  const app = await launchApp(profile!);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.hide();
      window.setSize(1412, 982);
      window.webContents.setBackgroundThrottling(false);
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const title = await page.evaluate(
      async ({ projectId, taskId }) => {
        const api = (window as unknown as { skaro: SkaroApi }).skaro;
        await api.invoke('app.setSetting', 'ui.locale', 'ru');
        await api.invoke('tabs.set', { projects: [projectId], active: projectId });
        const task = (await api.invoke('tasks.list', projectId)).find((t) => t.id === taskId);
        if (!task) throw new Error('Real task is missing');
        return task.title;
      },
      { projectId: projectId!, taskId: taskId! },
    );
    await page.reload();
    const tasks = page.getByRole('navigation').getByText('Задачи', { exact: true });
    const open = async (): Promise<void> => {
      await tasks.click();
      await page.locator('.board .card').filter({ hasText: title }).click();
      await expect(page.locator('.task .fd-feed')).toBeVisible();
    };
    await open();
    const scroller = page.locator('.task .feed-wrap > .scroller');
    const down = page.getByRole('button', { name: 'К концу диалога', exact: true });
    await expect.poll(() => distance(scroller)).toBeLessThan(3);
    expect(await scroller.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(800);
    await expect(down).toHaveCount(0);
    await page.screenshot({ path: join(profile!, 'task-feed-at-end.png') });
    // A browser-driven position change must not be mistaken for user input.
    await scroller.evaluate((el) => (el.scrollTop = 0));
    await expect.poll(() => distance(scroller)).toBeLessThan(3);
    await expect(down).toHaveCount(0);
    await scroller.hover();
    await page.mouse.wheel(0, -80);
    await expect.poll(() => distance(scroller)).toBeGreaterThan(20);
    await page.mouse.wheel(0, -1000);
    await expect.poll(() => distance(scroller)).toBeGreaterThan(300);
    await expect(down).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1312, 882));
    await expect.poll(() => distance(scroller)).toBeGreaterThan(300);
    await expect(down).toBeVisible();
    await down.click();
    await expect.poll(() => distance(scroller)).toBeLessThan(3);
    await expect(down).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1412, 982));
    await expect.poll(() => distance(scroller)).toBeLessThan(3);
    await scroller.hover();
    await page.mouse.wheel(0, -1000);
    await expect.poll(() => distance(scroller)).toBeGreaterThan(300);
    await open();
    await expect.poll(() => distance(scroller)).toBeLessThan(3);
    await expect(down).toHaveCount(0);
    await page.screenshot({ path: join(profile!, 'task-feed-reopened.png') });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
