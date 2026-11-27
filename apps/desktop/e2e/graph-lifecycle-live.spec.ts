import { expect, test } from '@playwright/test';
import { closeLiveApp, launchApp } from './launch';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const projectId = process.env['SKARO_VERIFICATION_PROJECT'];
test.skip(!profile || !projectId, 'Requires the real Cat-pilot verification profile');

test('only the explicitly opened graph owns graph processes and indexing', async () => {
  test.setTimeout(150_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    const status = () => page.evaluate((id) => window.skaro.invoke('graph.status', id), projectId!);
    const processes = () =>
      app.evaluate(({ app }) =>
        app
          .getAppMetrics()
          .flatMap(({ name, pid }) => (name?.startsWith('Skaro Graph ') ? [{ name, pid }] : [])),
      );
    const dormant = async () => {
      await expect.poll(processes).toEqual([]);
      expect(await status()).toMatchObject({ generation: 0, phase: 'cancelled' });
      const work = await page.evaluate(() => window.skaro.invoke('background.state'));
      expect(
        work.jobs.filter((job) => job.what === 'graph.index' && job.state === 'running'),
      ).toEqual([]);
    };

    await dormant();
    await expect(
      page.evaluate((id) => window.skaro.invoke('graph.rebuild', id), projectId!),
    ).rejects.toThrow('Graph view is closed');
    await page.getByRole('tab').filter({ hasText: 'Cat-pilot' }).click();
    const navigation = page.locator('.project-nav');
    const graph = navigation.getByRole('button', { name: /^(Граф связей|Relationship graph)$/i });
    const tasks = navigation.getByRole('button', { name: /^(Задачи|Tasks)(?:\s+\d+)?$/ });
    const c4 = navigation.getByRole('button', { name: 'C4', exact: true });
    await expect(graph).toBeVisible();
    await dormant();
    await c4.click();
    await expect(page.locator('[data-c4-gallery]')).toBeVisible();
    await dormant();

    await graph.click();
    await expect(page.locator('[data-project-graph] .sigma-host')).toHaveAttribute(
      'data-layout-ready',
      'true',
      { timeout: 60_000 },
    );
    await expect
      .poll(processes)
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Skaro Graph Queries' })]));
    await expect
      .poll(async () => (await status()).phase, { timeout: 60_000 })
      .toMatch(/^(ready|partial)$/);
    const saved = (await status()).snapshot?.id;
    expect(saved).toBeTruthy();

    await page.evaluate((id) => window.skaro.invoke('graph.rebuild', id), projectId!);
    await expect
      .poll(processes, { intervals: [50, 100, 200] })
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Skaro Graph Index' })]));
    await tasks.click();
    await expect(page.locator('[data-project-graph]')).toHaveCount(0);
    await dormant();

    await c4.click();
    await expect(page.locator('[data-c4-gallery]')).toBeVisible();
    await dormant();
    await graph.click();
    await expect.poll(async () => (await status()).snapshot?.id).toBe(saved);
    await expect.poll(processes).not.toEqual([]);

    await page.reload();
    await expect(page.locator('[data-project-graph]')).toHaveCount(0);
    await dormant();

    if (!(await graph.isVisible()))
      await page.getByRole('tab').filter({ hasText: 'Cat-pilot' }).click();
    await graph.click();
    await expect.poll(processes).not.toEqual([]);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.hide());
    await expect.poll(processes).toEqual([]);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.show());
    await expect(page.locator('[data-project-graph]')).toHaveCount(0);
    await dormant();
  } finally {
    await closeLiveApp(app);
  }
});
