import { expect, test } from '@playwright/test';
import { closeLiveApp, launchApp } from './launch';
import { revealChatRow } from './chat-list-live-support';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const projectId = process.env['SKARO_VERIFICATION_PROJECT'];
const chatId = process.env['SKARO_C4_REVIEW_CHAT'];
const itemId = process.env['SKARO_C4_REVIEW_ITEM'];
test.skip(!profile || !projectId || !chatId || !itemId, 'Requires a real Cat-pilot C4 package');

test('C4 workers belong to the open viewer, and a saved package renders both revisions', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(150_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    const layoutWorker = (worker: { url(): string }) => /elk-worker/i.test(worker.url());
    const workers = () => page.workers().filter(layoutWorker);
    let started = 0;
    page.on('worker', (worker) => {
      if (layoutWorker(worker)) started++;
    });
    expect(workers()).toHaveLength(0);
    await page.getByRole('tab').filter({ hasText: 'Cat-pilot' }).click();
    const navigation = page.locator('.project-nav');
    const c4 = navigation.getByRole('button', { name: 'C4', exact: true });
    const tasks = navigation.getByRole('button', { name: /^(Задачи|Tasks)(?:\s+\d+)?$/ });
    await expect(tasks).toBeVisible();
    expect(started).toBe(0);
    await c4.click();
    await expect(page.locator('[data-c4-gallery]')).toBeVisible();
    await expect.poll(() => started).toBeGreaterThan(0);
    await tasks.click();
    await expect(page.locator('[data-c4-gallery]')).toHaveCount(0);
    await expect.poll(workers).toEqual([]);

    await c4.click();
    await expect(page.locator('[data-c4-gallery]')).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.hide());
    await expect(page.locator('[data-c4-gallery]')).toHaveCount(0);
    await expect.poll(workers).toEqual([]);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.show());
    await expect(tasks).toBeVisible();

    const packageData = await page.evaluate(
      async ({ project, id }) => {
        const [review, before, after] = await Promise.all([
          window.skaro.invoke('c4.review', project, id),
          window.skaro.invoke('c4.reviewModel', project, id, 'before'),
          window.skaro.invoke('c4.reviewModel', project, id, 'after'),
        ]);
        const affected = new Set(
          review.model.filter((change) => change.group === 'views').map((change) => change.id),
        );
        return {
          review,
          before: before?.revision,
          after: after?.revision,
          affectedTitle: after?.views.find((view) => affected.has(view.id))?.title,
        };
      },
      { project: projectId!, id: itemId! },
    );
    expect(packageData.before).toBe(packageData.review.baseRevision);
    expect(packageData.after).toBe(packageData.review.revision);
    expect(packageData.after).not.toBe(packageData.before);
    expect(packageData.affectedTitle).toBeTruthy();

    await page
      .getByRole('navigation')
      .getByText(/^(Чат|Chat)$/)
      .click();
    await (await revealChatRow(page, projectId!, chatId!)).click();
    const card = page.locator(`[id="proposal-${itemId!}"] [data-architecture-proposal]`);
    await card.getByRole('button', { name: /^(Открыть|Open)$/ }).click();
    const diagram = page.getByRole('button', { name: /^(Открыть C4|Open C4)$/ });
    await expect(diagram).toBeVisible();
    const beforeReview = started;
    expect(workers()).toHaveLength(0);
    const viewer = page.locator('.c4-viewer-dialog');
    for (const [tab, revision] of [
      [/^(До|Before)$/, packageData.before],
      [/^(После|After)$/, packageData.after],
    ] as const) {
      await page.getByRole('radio', { name: tab }).click();
      await diagram.click();
      await expect(viewer.locator('.c4-viewer-heading')).toContainText(
        new RegExp(`(Редакция|Revision) ${revision}$`),
      );
      if (revision === packageData.after)
        await expect(viewer).toHaveAttribute('aria-label', packageData.affectedTitle!);
      await expect(viewer.locator('[data-c4-element]').first()).toBeVisible();
      await viewer.screenshot({ path: info.outputPath(`revision-${revision}.png`) });
      await viewer.getByRole('button', { name: /^(Закрыть|Close)$/ }).click();
      await expect(viewer).toHaveCount(0);
      await expect.poll(workers).toEqual([]);
      await expect(diagram).toBeVisible();
    }
    expect(started).toBeGreaterThan(beforeReview);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^(Закрыть|Close)$/ })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(workers).toEqual([]);
    expect(
      await app.evaluate(({ app }) =>
        app.getAppMetrics().filter(({ name }) => name?.startsWith('Skaro Graph ')),
      ),
    ).toEqual([]);
  } finally {
    await closeLiveApp(app);
  }
});
