import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { launchApp } from './launch';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_GRAPH_WORKING_PROFILE'];
const evidence = process.env['SKARO_GRAPH_EVIDENCE'];
const projectId = process.env['SKARO_GRAPH_WORKING_PROJECT'];
test.skip(
  !profile || !evidence || !projectId,
  'Requires explicit authorization for a working profile',
);

test('loads the working graph with its actual saved expansion and native services', async () => {
  test.setTimeout(180_000);
  await mkdir(evidence!, { recursive: true });
  const app = await launchApp(profile!, { openSavedProject: false });
  const errors: string[] = [];
  const stderr: string[] = [];
  app.process().stderr?.on('data', (data: Buffer) => stderr.push(String(data)));
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() => !!window.skaro);
    const projects = await page.evaluate(() => window.skaro.invoke('projects.list'));
    const project = projects.find((project) => project.id === projectId)!;
    expect(project).toBeDefined();
    const fingerprint = () =>
      Promise.all(
        ['.skaro/c4/model.json', '.skaro/architecture.md'].map(async (path) =>
          createHash('sha256')
            .update(await readFile(join(project.path, path)))
            .digest('hex'),
        ),
      );
    const before = await fingerprint();
    const saved = await page.evaluate((id) => window.skaro.invoke('graph.view', id), projectId!);
    expect(saved!.expanded.length).toBeGreaterThan(0);
    await page.getByRole('tab').filter({ hasText: project.name }).click();
    await page.getByRole('button', { name: 'Граф связей', exact: true }).click();
    const host = page.locator('.sigma-host');
    await expect(host).toHaveAttribute('data-layout-ready', 'true', { timeout: 30_000 });
    await expect(page.locator('.graph-alert')).toHaveCount(0);
    expect(
      Number(await page.locator('.graph-canvas').getAttribute('data-node-count')),
    ).toBeGreaterThan(0);
    const results = await page.evaluate(
      async ({ id, saved }) => {
        const status = await window.skaro.invoke('graph.status', id);
        const scope = {
          projectId: id,
          checkoutId: status.snapshot!.checkoutId,
          snapshotId: status.snapshot!.id,
          requestId: crypto.randomUUID(),
        };
        const start = performance.now();
        const pages = await Promise.all(
          Array.from({ length: 5 }, () =>
            window.skaro.invoke('graph.query', {
              ...scope,
              operation: 'overview',
              filter: saved!.filter,
              expanded: saved!.expanded,
            }),
          ),
        );
        return {
          ms: performance.now() - start,
          nodes: pages.map((page) => page.nodes.length),
          edges: pages.map((page) => page.edges.length),
          snapshot: status.snapshot!.id,
        };
      },
      { id: projectId!, saved },
    );
    expect(results.ms).toBeLessThan(5000);
    expect(results.nodes.every((count) => count === results.nodes[0] && count > 0)).toBe(true);
    expect(results.edges.every((count) => count === results.edges[0] && count > 0)).toBe(true);
    await page.screenshot({ path: join(evidence!, 'working-profile-graph.png') });
    // Return from another real section: restoration must retain the owner's expansion.
    await page.getByRole('button', { name: 'C4', exact: true }).click();
    await expect(page.locator('[data-c4-gallery]')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Граф связей', exact: true }).click();
    await expect(host).toHaveAttribute('data-layout-ready', 'true', { timeout: 30_000 });
    await expect(page.locator('.graph-alert')).toHaveCount(0);
    const after = await page.evaluate((id) => window.skaro.invoke('graph.view', id), projectId!);
    expect(after!.expanded).toEqual(saved!.expanded);
    expect(after!.filter).toEqual(saved!.filter);
    expect(after!.selected).toBe(saved!.selected);
    expect(await fingerprint()).toEqual(before);
    expect(errors).toEqual([]);
    expect(stderr.join('')).not.toContain('graph-worker-time-budget');
    expect(stderr.join('')).not.toContain('Graph worker timed out');
    await page.screenshot({ path: join(evidence!, 'working-profile-restored.png') });
    await writeFile(
      join(evidence!, 'working-profile-results.json'),
      JSON.stringify(
        {
          native: true,
          profile,
          projectId,
          results,
          expanded: saved!.expanded,
          errors,
          sourceHashesUnchanged: true,
          savedSelectionAndFiltersUnchanged: true,
        },
        null,
        2,
      ),
    );
    console.log('Working-profile graph:', results);
  } catch (error) {
    const page = await app.firstWindow();
    await page.screenshot({ path: join(evidence!, 'working-profile-failure.png') });
    console.log(await page.locator('body').innerText());
    throw error;
  } finally {
    await writeFile(join(evidence!, 'working-profile-stderr.log'), stderr.join(''));
    await app.close();
  }
});
