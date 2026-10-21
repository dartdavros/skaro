import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { launchApp } from './launch';
import { drawnGraphNames, observeGraphLabels } from './graph-label-observer';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const root = process.env.SKARO_GRAPH_VERIFY_ROOT;
const evidence = process.env.SKARO_GRAPH_EVIDENCE;
test.skip(!root || !evidence, 'Requires a genuine project and an evidence directory');

test('draws every direct neighbor label on hover and selection in the native graph', async () => {
  test.setTimeout(300_000);
  await mkdir(evidence!, { recursive: true });
  const fingerprint = () =>
    Promise.all(
      ['.skaro/c4/model.json', '.skaro/architecture.md'].map(async (path) =>
        createHash('sha256')
          .update(await readFile(join(root!, path)))
          .digest('hex'),
      ),
    );
  const before = await fingerprint();
  const app = await launchApp(await mkdtemp(join(evidence!, 'labels-profile-')), {
    openSavedProject: false,
  });
  const errors: string[] = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await observeGraphLabels(page);
    await page.waitForFunction(() => !!window.skaro);
    const project = await page.evaluate(async (path) => {
      const project = await window.skaro.invoke('projects.add', path);
      await window.skaro.invoke('tabs.set', { projects: [project.id], active: project.id });
      await window.skaro.invoke('app.setLocale', 'ru');
      await window.skaro.invoke('app.setSetting', 'ui.workspace', {
        view: 'project',
        sections: { [project.id]: 'graph' },
        openTasks: {},
        openChats: {},
      });
      return project;
    }, root!);
    await page.reload();
    const host = page.locator('.sigma-host');
    await expect(host).toHaveAttribute('data-layout-ready', 'true', { timeout: 180_000 });
    await expect(host).toHaveAttribute('data-layout-moving', 'false', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Показать целиком', exact: true }).click();
    const graph = await page.evaluate(async (id) => {
      const status = await window.skaro.invoke('graph.status', id);
      return window.skaro.invoke('graph.query', {
        projectId: id,
        snapshotId: status.snapshot!.id,
        checkoutId: status.snapshot!.checkoutId,
        requestId: crypto.randomUUID(),
        operation: 'overview',
        filter: { state: 'current' },
      });
    }, project.id);
    expect(Number(await page.locator('.graph-canvas').getAttribute('data-node-count'))).toBe(
      graph.nodes.length,
    );
    const drawing = await page.evaluate(() => window.graphDrawing);
    const visible = await drawnGraphNames(
      page,
      graph.nodes.map((node) => node.name),
    );
    const candidates = graph.nodes.flatMap((node) => {
      const ids = new Set(
        graph.edges.flatMap((edge) =>
          edge.source === node.id ? [edge.target] : edge.target === node.id ? [edge.source] : [],
        ),
      );
      ids.delete(node.id);
      const names = graph.nodes.filter((item) => ids.has(item.id)).map((item) => item.name);
      const label = drawing.labels.find((label) => node.name.startsWith(label.text));
      const point =
        label &&
        drawing.nodes.find(
          (point) =>
            Math.abs(point.x - label.x) < 0.1 && label.y - point.y > 0 && label.y - point.y < 45,
        );
      return point && names.length > 1 && names.some((name) => !visible.includes(name))
        ? [{ node, names, point }]
        : [];
    });
    expect(candidates.length).toBeGreaterThan(0);
    const candidate = candidates[0]!;
    const box = (await host.boundingBox())!;
    await page.screenshot({ path: join(evidence!, 'labels-baseline.png') });
    await page.mouse.move(box.x + candidate.point.x, box.y + candidate.point.y);
    await expect.poll(() => drawnGraphNames(page, candidate.names)).toEqual(candidate.names);
    await page.screenshot({ path: join(evidence!, 'labels-hover.png') });
    await page.mouse.move(5, 5);
    await expect.poll(() => drawnGraphNames(page, candidate.names)).not.toEqual(candidate.names);
    await page.mouse.click(box.x + candidate.point.x, box.y + candidate.point.y);
    await page.mouse.move(5, 5);
    await expect(page.locator('.graph-details, .c4-details')).toBeVisible();
    await page.getByRole('button', { name: 'Показать целиком', exact: true }).click();
    await expect.poll(() => drawnGraphNames(page, candidate.names)).toEqual(candidate.names);
    await page.screenshot({ path: join(evidence!, 'labels-selected.png') });
    await page
      .locator('.c4-viewer-header')
      .getByRole('button', { name: 'Снять выделение', exact: true })
      .click();
    await expect.poll(() => drawnGraphNames(page, candidate.names)).not.toEqual(candidate.names);
    expect(errors).toEqual([]);
    expect(await fingerprint()).toEqual(before);
    console.log('Verified direct neighbor labels:', {
      node: candidate.node.name,
      neighbors: candidate.names,
      initiallyHidden: candidate.names.filter((name) => !visible.includes(name)),
    });
  } catch (error) {
    const page = await app.firstWindow();
    await page.screenshot({ path: join(evidence!, 'labels-failure.png') });
    console.log(await page.locator('body').innerText());
    throw error;
  } finally {
    await app.close();
  }
});
