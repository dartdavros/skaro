import { expect, test } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp } from './launch';
import type { SkaroApi } from '../src/shared/ipc';
import type { ShutdownState } from '../src/shared/shutdown';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env.SKARO_SHUTDOWN_LIVE_PROFILE;
const scope = process.env.SKARO_VERIFICATION_PROJECT;
test.skip(!profile || !scope, 'Requires the real registered Cat-pilot profile and project scope');

test('paints the agreed screen during real shutdown and closes its native window', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(180_000);
  const db = new DatabaseSync(join(profile!, 'skaro.db'), { readOnly: true });
  try {
    expect(db.prepare('SELECT name FROM projects WHERE id=?').get(scope!)?.name).toBe('Cat-pilot');
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM owner_commands WHERE owner LIKE ? AND state IN ('accepted','delivering')",
        )
        .get(`${scope}:%`)?.n,
    ).toBe(0);
  } finally {
    db.close();
  }
  const app = await launchApp(profile!, { openSavedProject: false });
  const snapshots: ShutdownState[] = [];
  const frames: {
    title: string;
    stage: string;
    time: string;
    normalUI: boolean;
    spinner: boolean;
    closeDisabled: boolean;
    slow: boolean;
    detailsOpen: boolean;
  }[] = [];
  const errors: string[] = [];
  let exited = false;
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator('.bar').waitFor();
    const projects = await page.evaluate(() => window.skaro.invoke('projects.list'));
    expect(projects.map((project) => project.id)).toEqual([scope]);
    await page.exposeFunction('recordShutdownState', (state: ShutdownState) =>
      snapshots.push(state),
    );
    await page.exposeFunction('recordShutdownFrame', (frame: (typeof frames)[number]) =>
      frames.push(frame),
    );
    await page.evaluate(() => {
      window.skaro.on('app.shutdown', (state) => {
        void (window as unknown as { recordShutdownState(state: ShutdownState): Promise<void> })
          .recordShutdownState(state)
          .catch(() => undefined);
      });
      let previous = '';
      const sample = () => {
        const root = document.querySelector('.shutdown-app');
        if (root) {
          const frame = {
            title: root.querySelector('h1')?.textContent,
            stage: root.querySelector('.stage')?.textContent,
            time: root.querySelector('.elapsed')?.textContent,
            normalUI: !!root.querySelector('.bar .tabs button, .bar .right .icon-btn'),
            spinner: !!root.querySelector('.loading-indicator'),
            closeDisabled:
              root.querySelector<HTMLButtonElement>('.bar .controls .close')?.disabled ?? true,
            slow: root.querySelector('.wait-note')?.classList.contains('visible') ?? false,
            detailsOpen: root.querySelector('details')?.open ?? false,
          };
          const signature = JSON.stringify(frame);
          if (signature !== previous) {
            previous = signature;
            void (window as unknown as { recordShutdownFrame(frame: unknown): Promise<void> })
              .recordShutdownFrame(frame)
              .catch(() => undefined);
          }
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const closed = app.waitForEvent('close', { timeout: 90_000 });
    await app.evaluate(({ app }) => {
      setTimeout(() => app.quit(), 0);
    });
    const screen = page.locator('.shutdown-app');
    await screen.waitFor();
    await page.screenshot({ path: info.outputPath('shutdown-collapsed.png') });
    await screen.locator('summary').click();
    await expect(screen.locator('details')).toHaveAttribute('open', '');
    await page.screenshot({ path: info.outputPath('shutdown-details.png') });
    const slowScreenshot = screen
      .locator('.wait-note.visible')
      .waitFor({ timeout: 45_000 })
      .then(() => page.screenshot({ path: info.outputPath('shutdown-slow.png') }))
      .catch(() => undefined);
    await closed;
    await slowScreenshot;
    exited = true;
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots[0]?.stage).toBe('agents');
    expect(snapshots.every((state) => state.startedAt === snapshots[0]!.startedAt)).toBe(true);
    expect(
      snapshots.every((state, index) => !index || state.revision > snapshots[index - 1]!.revision),
    ).toBe(true);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((frame) => /Закрываем Skaro|Closing Skaro/.test(frame.title))).toBe(true);
    expect(frames.every((frame) => /^\d{2,}:\d{2}$/.test(frame.time))).toBe(true);
    expect(frames.every((frame) => frame.spinner && frame.closeDisabled && !frame.normalUI)).toBe(
      true,
    );
    const slowFrames = frames.filter(
      (frame) => Number(frame.time.split(':')[0]) * 60 + Number(frame.time.split(':')[1]) >= 30,
    );
    expect(slowFrames.every((frame) => frame.slow)).toBe(true);
    expect(errors).toEqual([]);
    writeFileSync(
      info.outputPath('shutdown-proof.json'),
      JSON.stringify({ scope, snapshots, frames, detailsChecked: true, errors, exited }, null, 2),
    );
  } finally {
    if (!exited) await app.close();
  }
});

test('quits immediately from the real shutdown screen and rejects the action while running', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(120_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  let exited = false;
  try {
    const page = await app.firstWindow();
    await page.locator('.bar').waitFor();
    const projects = await page.evaluate(() => window.skaro.invoke('projects.list'));
    expect(projects.map((project) => project.id)).toEqual([scope]);
    const refusal = await page.evaluate(() =>
      window.skaro.invoke('app.shutdownNow').then(
        () => '',
        (error: Error) => error.message,
      ),
    );
    expect(refusal).toContain('shutdown has not started');
    const closed = app.waitForEvent('close', { timeout: 90_000 });
    await app.evaluate(({ app }) => {
      setTimeout(() => app.quit(), 0);
    });
    const screen = page.locator('.shutdown-app');
    await screen.waitFor();
    await screen.locator('summary').click();
    const button = screen.getByRole('button', { name: /^(Завершить сейчас|Quit now)$/ });
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    const size = await button.boundingBox();
    expect(size?.height).toBe(28);
    await page.screenshot({ path: info.outputPath('shutdown-quit-now.png') });
    const clickedAt = Date.now();
    await button.click({ noWaitAfter: true });
    await closed;
    exited = true;
    const elapsedMs = Date.now() - clickedAt;
    expect(elapsedMs).toBeLessThan(5000);
    writeFileSync(
      info.outputPath('shutdown-quit-now-proof.json'),
      JSON.stringify({ scope, refusal, elapsedMs, exited }, null, 2),
    );
  } finally {
    if (!exited) await app.close();
  }
});
