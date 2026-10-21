import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchApp } from './launch';
import type { SkaroApi } from '../src/shared/ipc';
import { verifyGraphContract } from './graph-feature-contract';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { exportGraphPreview } from './graph-preview-export';

declare const window: Window & { skaro: SkaroApi };
const root = process.env.SKARO_GRAPH_VERIFY_ROOT;
const evidence = process.env.SKARO_GRAPH_EVIDENCE;
test.skip(!root || !evidence, 'Requires a genuine project and an evidence directory');

test('background graph and native graph/C4 sections on the real Chatballs checkout', async () => {
  test.setTimeout(300_000);
  await mkdir(evidence!, { recursive: true });
  const fingerprint = async () =>
    Promise.all(
      ['.skaro/c4/model.json', '.skaro/architecture.md'].map(async (path) =>
        createHash('sha256')
          .update(await readFile(join(root!, path)))
          .digest('hex'),
      ),
    );
  const before = await fingerprint();
  const app = await launchApp(join(evidence!, 'profile'), { openSavedProject: false });
  const errors: string[] = [];
  app.process().stderr?.on('data', (data: Buffer) => console.log(String(data)));
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    await page.waitForFunction(() => !!window.skaro);
    const project = await page.evaluate(async (path) => {
      const project = await window.skaro.invoke('projects.add', path);
      await window.skaro.invoke('tabs.set', { projects: [project.id], active: project.id });
      await window.skaro.invoke('app.setLocale', 'ru');
      await window.skaro.invoke('app.setSetting', 'ui.workspace', {
        view: 'project',
        sections: { [project.id]: 'tasks' },
        openTasks: {},
        openChats: {},
      });
      return project;
    }, root!);
    // No graph or C4 section has been opened: indexing must already be running.
    await expect
      .poll(
        async () => {
          const status = await page.evaluate(
            (id) => window.skaro.invoke('graph.status', id),
            project.id,
          );
          console.log('graph status', status.phase, status.progress, status.error);
          if (status.phase === 'error' || status.phase === 'unavailable')
            throw new Error(status.error);
          return !!status.snapshot && !['indexing', 'stale', 'queued'].includes(status.phase);
        },
        { timeout: 180_000, intervals: [1000, 3000, 5000] },
      )
      .toBe(true);
    const status = await page.evaluate((id) => window.skaro.invoke('graph.status', id), project.id);
    await writeFile(join(evidence!, 'status.json'), JSON.stringify(status, null, 2));
    expect(status.snapshot!.nodes).toBeGreaterThan(1000);
    const accepted = JSON.parse(await readFile(join(root!, '.skaro/c4/model.json'), 'utf8'));
    const contract = await verifyGraphContract(page, status, accepted);
    await writeFile(join(evidence!, 'contract.json'), JSON.stringify(contract, null, 2));
    const overview = await page.evaluate(async (status) => {
      const scope = {
        projectId: status.projectId,
        checkoutId: status.snapshot!.checkoutId,
        snapshotId: status.snapshot!.id,
        requestId: crypto.randomUUID(),
      };
      return window.skaro.invoke('graph.query', {
        ...scope,
        operation: 'overview',
        filter: { state: 'current' },
      });
    }, status);
    await writeFile(join(evidence!, 'overview-data.json'), JSON.stringify(overview, null, 2));
    await app.evaluate(
      async ({ BrowserWindow }, index) => {
        await BrowserWindow.getAllWindows()[0]!.webContents.loadFile(index);
      },
      join(__dirname, '../out/renderer/index.html'),
    );
    console.log(await page.locator('.project-nav').innerText());
    await page.getByRole('button', { name: 'Граф связей', exact: true }).click();
    await page.locator('[data-project-graph]').waitFor({ timeout: 30_000 });
    for (const name of [
      'Архитектурное состояние',
      'Слои',
      'Типы связей',
      'Происхождение и ограничения',
    ]) {
      await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    console.log('graph screen:', await page.locator('[data-project-graph]').innerText());
    await page
      .locator('[data-project-graph] .sigma-host[data-layout-ready="true"]')
      .waitFor({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Показать целиком', exact: true }).click();
    await page.screenshot({ path: join(evidence!, 'overview.png') });
    const canvas = page.locator('.graph-canvas');
    expect(Number(await canvas.getAttribute('data-node-count'))).toBeGreaterThan(140);
    const host = page.locator('.sigma-host');
    await expect(host).toHaveAttribute('data-layout-moving', 'false', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Приостановить движение', exact: true }).click();
    const paused = await host.getAttribute('data-motion-frame');
    await page.waitForTimeout(300);
    expect(await host.getAttribute('data-motion-frame')).toBe(paused);
    await page.getByRole('button', { name: 'Продолжить движение', exact: true }).click();
    const scenario = accepted.views.find(
      (view: { kind: string; title: string }) =>
        view.kind === 'dynamic' && view.title.includes('Веб-обращение'),
    );
    await page.getByRole('button', { name: 'Представление', exact: true }).click();
    await page.getByRole('option').filter({ hasText: scenario.title }).click();
    await expect(host).toHaveAttribute('data-playback-phase', 'paused');
    await page.getByRole('button', { name: 'Следующий шаг', exact: true }).click();
    await expect(host).toHaveAttribute('data-playback-step', '2');
    await page.getByRole('button', { name: 'Воспроизвести сценарий', exact: true }).click();
    await expect
      .poll(() => host.getAttribute('data-playback-step'), { timeout: 8000 })
      .not.toBe('2');
    await page.getByRole('button', { name: 'Приостановить сценарий', exact: true }).click();
    const step = await host.getAttribute('data-playback-step');
    await page.waitForTimeout(2400);
    expect(await host.getAttribute('data-playback-step')).toBe(step);
    await page.screenshot({ path: join(evidence!, 'scenario.png') });
    const unavailable = accepted.elements.find(
      (node: { state: string; code: string[] }) =>
        node.state === 'planned' && node.code.some((path) => !existsSync(join(root!, path))),
    );
    expect(unavailable).toBeDefined();
    if (unavailable) {
      const path = unavailable.code.find((path: string) => !existsSync(join(root!, path)))!;
      await page.getByRole('textbox', { name: 'Найти элемент' }).fill(unavailable.name);
      await page.getByRole('option').filter({ hasText: unavailable.name }).first().click();
      await page.locator('.c4-details').getByRole('button', { name: path, exact: true }).click();
      await page.locator('.graph-alert').waitFor();
      const gutter = await page.evaluate(() => {
        const area = document.querySelector('[data-project-graph]')!.getBoundingClientRect();
        const alert = document.querySelector('.graph-alert')!.getBoundingClientRect();
        const style = getComputedStyle(document.querySelector('.graph-alert')!);
        return {
          left: alert.left - area.left,
          right: area.right - alert.right,
          top: style.marginTop,
          bottom: style.marginBottom,
        };
      });
      expect(gutter).toEqual({ left: 18, right: 18, top: '8px', bottom: '12px' });
      await page.screenshot({ path: join(evidence!, 'alert-spacing.png') });
      await page.locator('.graph-alert').getByRole('button').click();
      await page.getByRole('button', { name: 'Снять выделение', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Представление', exact: true }).click();
    await page.getByRole('option').filter({ hasText: 'Весь проект' }).click();
    const zoom = page.getByRole('spinbutton');
    await zoom.fill('150%');
    await zoom.press('Enter');
    await expect(zoom).toHaveText('150%');
    await zoom.fill('не число');
    await zoom.press('Enter');
    await expect(zoom).toHaveText('150%');
    await zoom.fill('200%');
    await zoom.press('Escape');
    await expect(zoom).toHaveText('150%');
    await page.screenshot({ path: join(evidence!, 'zoom-150.png') });
    const settled = await page.evaluate(
      (id) => window.skaro.invoke('graph.status', id),
      project.id,
    );
    expect(['error', 'unavailable']).not.toContain(settled.phase);
    await expect(page.getByText('database is locked', { exact: true })).toHaveCount(0);
    if (process.env.SKARO_GRAPH_EXPORT === '1') await exportGraphPreview(page, root!, evidence!);
    await page.getByRole('button', { name: 'C4', exact: true }).click();
    await page.locator('[data-c4-gallery]').getByRole('button').first().click();
    await page.locator('[data-c4-element]').first().waitFor({ timeout: 30_000 });
    await page.getByRole('spinbutton').fill('125%');
    await page.getByRole('spinbutton').press('Enter');
    await expect(page.getByRole('spinbutton')).toHaveText('125%');
    await page.screenshot({ path: join(evidence!, 'c4.png') });
    const saved = await page.evaluate((id) => window.skaro.invoke('graph.view', id), project.id);
    expect(saved?.camera?.ratio).toBeCloseTo(1 / 1.5, 2);
    await page
      .locator('.project-nav')
      .getByRole('button', { name: 'Документы', exact: true })
      .click();
    await expect(page.locator('[data-doc-tree].group').filter({ hasText: 'Прочее' })).toBeVisible();
    expect(await page.locator('[data-doc-tree]').filter({ hasText: 'Граф связей' }).count()).toBe(
      0,
    );
    const cancelled = await page.evaluate(async (id) => {
      const before = await window.skaro.invoke('graph.status', id);
      await window.skaro.invoke('graph.rebuild', id);
      const after = await window.skaro.invoke('graph.cancel', id);
      return { before: before.snapshot?.id, after: after.snapshot?.id, phase: after.phase };
    }, project.id);
    expect(cancelled.phase).toBe('cancelled');
    expect(cancelled.after).toBe(cancelled.before);
    expect(errors).toEqual([]);
    expect(await fingerprint()).toEqual(before);
  } catch (error) {
    const page = await app.firstWindow();
    await page.screenshot({ path: join(evidence!, 'failure.png') });
    await writeFile(join(evidence!, 'failure-dom.txt'), await page.locator('body').innerText());
    throw error;
  } finally {
    await app.close();
  }
});
