import { ArtifactStore, expand, git } from '@skaro/core';
import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SkaroApi } from '../src/shared/ipc';
import type { EnvironmentRecord } from '../src/main/task-environment-registry';
import { launchApp, noAgents, noAgentsReason } from './launch';
import { prepareLiveReviewProfile, type LiveReviewTask } from './environment-review-live-profile';
import {
  runningContainers,
  stopLiveDocker,
  volumeIdentity,
} from './environment-review-live-docker';

declare const window: Window & {
  skaro: SkaroApi;
  liveReviewRequests?: Record<string, Promise<string | undefined>>;
};
const profile = process.env.SKARO_LIVE_PROFILE;
const taskIds = (process.env.SKARO_LIVE_TASKS ?? '').split(',').filter(Boolean);
test.skip(
  !profile || taskIds.length !== 2,
  'Opt-in: requires two existing stopped task environments',
);
test.skip(noAgents, noAgentsReason);

async function openTask(page: Page, task: LiveReviewTask): Promise<void> {
  await page
    .locator('.project-nav')
    .getByRole('button', { name: /^Задачи/ })
    .click();
  await page.locator('.board .card').filter({ hasText: task.title }).click();
  await expect(page.locator('.task-conversation')).toBeVisible();
}

async function requestReview(page: Page, task: LiveReviewTask): Promise<void> {
  await page.evaluate(({ projectId, taskId, url }) => {
    window.liveReviewRequests ??= {};
    window.liveReviewRequests[taskId] = window.skaro
      .invoke('task.openExternal', projectId, taskId, url)
      .then(
        () => undefined,
        (error: unknown) => String(error),
      );
  }, task);
}

async function reviewState(page: Page, task: LiveReviewTask) {
  return page.evaluate(
    async ({ projectId, taskId }) =>
      (await window.skaro.invoke('task.open', projectId, taskId)).environmentReview,
    task,
  );
}

async function fingerprint(root: string) {
  const artifacts = await new ArtifactStore(root).load();
  return {
    refs: (await git(root, ['show-ref'])).stdout,
    tasks: await Promise.all(
      artifacts.tasks.map(async (task) => [
        task.id,
        createHash('sha256')
          .update(await readFile(join(root, task.path)))
          .digest('hex'),
      ]),
    ),
  };
}

// Real AppDb records, task worktrees, Compose services, databases and native IPC only.
// The shell opens the actual local URL; no browser or backend method is replaced.
test('independent manual reviews run in parallel, preserve data and stop after finish or native restart', async ({
  playwright: _playwright,
}, testInfo) => {
  test.setTimeout(900_000);
  const live = await prepareLiveReviewProfile(profile!, taskIds);
  const [first, second] = live.tasks as [LiveReviewTask, LiveReviewTask];
  const before = await fingerprint(first.identity.root);
  const errors: string[] = [];
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  const launch = async () => {
    app = await launchApp(live.userData);
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() => !!window.skaro);
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      win.setSize(1412, 982);
      win.showInactive();
    });
    return page;
  };
  try {
    let page = await launch();
    await openTask(page, first);
    expect(await reviewState(page, first)).toBeUndefined();
    expect(await runningContainers(first.identity.name)).toEqual([]);
    await requestReview(page, first);
    const banner = page.locator('.task-conversation .banners .banner.info');
    await expect(banner).toContainText('Запускает окружение…', { timeout: 30_000 });
    await page.screenshot({ path: testInfo.outputPath('review-starting.png') });
    await expect(banner).toContainText('Окружение запущено для просмотра', { timeout: 600_000 });
    await expect.poll(() => runningContainers(first.identity.name)).not.toEqual([]);
    const current = (await page.evaluate(() =>
      window.skaro.invoke('app.getSetting', 'environments'),
    )) as EnvironmentRecord[];
    const record = current.find(
      (item) => item.projectId === first.projectId && item.taskId === first.taskId,
    )!;
    const ready = expand(first.readyTemplate, { ...first.identity, ports: record.ports });
    const response = await page.request.get(ready, { timeout: 30_000 });
    expect(response.ok(), `The real documented readiness endpoint: ${response.status()}`).toBe(
      true,
    );
    expect(
      await page.evaluate((id) => window.liveReviewRequests![id], first.taskId),
    ).toBeUndefined();
    await page.screenshot({ path: testInfo.outputPath('review-running.png') });

    await openTask(page, second);
    await requestReview(page, second);
    await expect(banner).toContainText('Окружение запущено для просмотра', { timeout: 600_000 });
    expect(await runningContainers(first.identity.name)).not.toEqual([]);
    expect(await runningContainers(second.identity.name)).not.toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('review-parallel.png') });
    await banner.getByRole('button', { name: 'Завершить просмотр', exact: true }).click();
    await expect.poll(() => reviewState(page, second), { timeout: 60_000 }).toBeUndefined();
    expect(await runningContainers(second.identity.name)).toEqual([]);
    expect(await volumeIdentity(second.identity.name)).toEqual(second.volumes);
    expect(await runningContainers(first.identity.name)).not.toEqual([]);

    await openTask(page, first);
    await banner.getByRole('button', { name: 'Завершить просмотр', exact: true }).click();
    await expect.poll(() => reviewState(page, first), { timeout: 60_000 }).toBeUndefined();
    await expect.poll(() => runningContainers(first.identity.name)).toEqual([]);
    expect(await volumeIdentity(first.identity.name)).toEqual(first.volumes);
    await page.screenshot({ path: testInfo.outputPath('review-finished.png') });

    // Cancel a real warm start: its shell and services must not outlive the review owner.
    await requestReview(page, first);
    await expect(banner).toContainText('Запускает окружение…', { timeout: 30_000 });
    await banner.getByRole('button', { name: 'Завершить просмотр', exact: true }).click();
    await expect.poll(() => reviewState(page, first), { timeout: 60_000 }).toBeUndefined();
    expect(await runningContainers(first.identity.name)).toEqual([]);
    expect(await volumeIdentity(first.identity.name)).toEqual(first.volumes);

    await requestReview(page, first);
    await expect(banner).toContainText('Окружение запущено для просмотра', { timeout: 600_000 });
    expect(await volumeIdentity(first.identity.name)).toEqual(first.volumes);
    const measured = await page.evaluate(async (task) => {
      const records = (await window.skaro.invoke(
        'app.getSetting',
        'environments',
      )) as EnvironmentRecord[];
      return records.find(
        (record) => record.projectId === task.projectId && record.taskId === task.taskId,
      )?.lastStart;
    }, first);
    expect(measured?.reusedData).toBe(true);
    expect(measured?.createMs).toBe(0);
    await testInfo.attach('warm-start-timings', {
      body: JSON.stringify(measured),
      contentType: 'application/json',
    });
    // app.exit bypasses the graceful shutdown path; only this test-owned Electron exits.
    const exited = new Promise<void>((resolve) => app!.process().once('exit', () => resolve()));
    await app!.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await exited;
    app = undefined;
    page = await launch();
    await openTask(page, first);
    await expect.poll(() => reviewState(page, first), { timeout: 60_000 }).toBeUndefined();
    await expect
      .poll(() => runningContainers(first.identity.name), { timeout: 30_000 })
      .toEqual([]);
    expect(await volumeIdentity(first.identity.name)).toEqual(first.volumes);
    await expect(page.locator('.task-conversation .banners')).not.toContainText(
      'Завершить просмотр',
    );
    await page.screenshot({ path: testInfo.outputPath('review-restored.png') });
    expect(errors).toEqual([]);
    expect(await fingerprint(first.identity.root)).toEqual(before);
  } finally {
    try {
      await app?.close();
    } finally {
      await stopLiveDocker(live.tasks.map((task) => task.identity.name));
    }
  }
});
