import { test, expect, type Page } from '@playwright/test';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { launchApp } from './launch';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const root = process.env.SKARO_GRAPH_VERIFY_ROOT;
const evidence = process.env.SKARO_GRAPH_EVIDENCE;
test.skip(!root || !evidence, 'Requires a genuine project and an evidence directory');

async function scrollMenu(page: Page): Promise<void> {
  const menu = page.getByRole('menu').last();
  await expect
    .poll(() => menu.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);
  await menu.hover();
  await page.mouse.wheel(0, 400);
  await expect.poll(() => menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const box = await menu.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
}

test('graph corrections on genuine sources with native main/preload and clipboard', async () => {
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
  const app = await launchApp(await mkdtemp(join(evidence!, 'defects-profile-')), {
    openSavedProject: false,
  });
  const errors: string[] = [];
  const stderr: string[] = [];
  app.process().stderr?.on('data', (data: Buffer) => stderr.push(String(data)));
  const clipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() => !!window.skaro);
    await page.evaluate(() => window.skaro.invoke('app.setLocale', 'ru'));
    await page.reload();
    await expect(page.locator('.empty .mark img')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.empty .mark svg')).toHaveCount(0);
    const selectedText = await page.locator('.empty-text').innerText();
    await page
      .locator('.empty-text')
      .evaluate((element) => getSelection()!.selectAllChildren(element));
    await page.getByRole('button', { name: 'Скопировать', exact: true }).click();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(selectedText);
    await page.screenshot({ path: join(evidence!, 'home.png') });
    const project = await page.evaluate(async (path) => {
      const project = await window.skaro.invoke('projects.add', path);
      await window.skaro.invoke('tabs.set', { projects: [project.id], active: project.id });
      await window.skaro.invoke('app.setSetting', 'ui.workspace', {
        view: 'project',
        sections: { [project.id]: 'c4' },
        openTasks: {},
        openChats: {},
      });
      return project;
    }, root!);
    await page.reload();
    const model = JSON.parse(await readFile(join(root!, '.skaro/c4/model.json'), 'utf8'));
    const gallery = page.locator('[data-c4-gallery]');
    await expect(gallery.locator('[data-c4-preview]')).toHaveCount(model.views.length);
    await expect(page.locator('.c4-viewer')).toHaveCount(0);
    await gallery.locator('.c4-preview-svg').first().waitFor({ timeout: 30_000 });
    await gallery
      .locator('[data-c4-preview]')
      .nth(3)
      .locator('.c4-preview-svg')
      .waitFor({ timeout: 30_000 });
    await page.screenshot({ path: join(evidence!, 'c4-gallery.png'), animations: 'disabled' });
    await gallery.getByRole('button').first().click();
    await page.locator('[data-c4-element]').first().waitFor({ timeout: 30_000 });
    const background = await page
      .locator('.c4-viewer')
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(background).toBe(
      await page
        .evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--sk-bg').trim(),
        )
        .then((color) =>
          page.evaluate((color) => {
            const element = document.createElement('span');
            element.style.color = color;
            document.body.append(element);
            const computed = getComputedStyle(element).color;
            element.remove();
            return computed;
          }, color),
        ),
    );
    await page.getByRole('button', { name: 'Представление', exact: true }).click();
    await scrollMenu(page);
    await page.keyboard.press('Escape');
    await page.getByRole('spinbutton').fill('125%');
    await page.getByRole('spinbutton').press('Enter');
    await expect(page.getByRole('spinbutton')).toHaveText('125%');
    await page.screenshot({ path: join(evidence!, 'c4-canvas.png') });
    await page.locator('.c4-viewer').getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(gallery).toBeVisible();
    await page.getByRole('button', { name: 'Граф связей', exact: true }).click();
    const host = page.locator('.sigma-host');
    await host.waitFor();
    await page.getByRole('button', { name: 'Приостановить движение', exact: true }).click();
    await expect(host).toHaveAttribute('data-layout-ready', 'true', { timeout: 60_000 });
    const pausedFrame = await host.getAttribute('data-motion-frame');
    await page.waitForTimeout(250);
    expect(await host.getAttribute('data-motion-frame')).toBe(pausedFrame);
    await page.getByRole('button', { name: 'Продолжить движение', exact: true }).click();
    await expect(host).toHaveAttribute('data-layout-moving', 'false', { timeout: 15_000 });
    const settledFrame = await host.getAttribute('data-motion-frame');
    await page.waitForTimeout(250);
    expect(await host.getAttribute('data-motion-frame')).toBe(settledFrame);
    await page.getByRole('button', { name: 'Покрытие анализа', exact: true }).click();
    await expect(page.locator('.graph-coverage')).toBeInViewport();
    await page.screenshot({ path: join(evidence!, 'coverage.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Представление', exact: true }).click();
    await scrollMenu(page);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Типы связей', exact: true }).click();
    await scrollMenu(page);
    await page.keyboard.press('Escape');
    const overviewCount = Number(
      await page.locator('.graph-canvas').getAttribute('data-node-count'),
    );
    await page.getByRole('button', { name: 'Слои', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Файл', exact: true }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Документ', exact: true }).click();
    await expect(page.getByRole('menuitemcheckbox', { checked: true })).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect
      .poll(
        async () => Number(await page.locator('.graph-canvas').getAttribute('data-node-count')),
        { timeout: 30_000 },
      )
      .toBeLessThan(overviewCount);
    await page.getByRole('button', { name: 'C4', exact: true }).click();
    await expect(gallery).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Граф связей', exact: true }).click();
    await page.getByRole('button', { name: 'Слои', exact: true }).click();
    await expect(page.getByRole('menuitemcheckbox', { checked: true })).toHaveCount(2);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Происхождение и ограничения', exact: true }).click();
    await page.getByRole('button', { name: 'Подсистема', exact: true }).click();
    expect(await page.getByRole('menuitemcheckbox').allTextContents()).not.toEqual(
      expect.arrayContaining([expect.stringContaining('.skaro')]),
    );
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Происхождение и ограничения', exact: true }).click();
    await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click();
    await page.keyboard.press('Escape');
    const queryResults = await page.evaluate(async (id) => {
      const status = await window.skaro.invoke('graph.status', id);
      const scope = {
        projectId: id,
        snapshotId: status.snapshot!.id,
        checkoutId: status.snapshot!.checkoutId,
        requestId: crypto.randomUUID(),
      };
      const overview = await window.skaro.invoke('graph.query', {
        ...scope,
        operation: 'overview',
        filter: { state: 'all' },
      });
      const documents = await window.skaro.invoke('graph.query', {
        ...scope,
        operation: 'overview',
        filter: { kinds: ['document', 'requirement', 'task', 'milestone'] },
      });
      const languages = await window.skaro.invoke('graph.query', {
        ...scope,
        operation: 'overview',
        filter: { kinds: ['file'], languages: ['python', 'svelte'] },
      });
      return { overview, documents, languages };
    }, project.id);
    expect(queryResults.overview.nodes.some((node) => node.id.startsWith('group:.skaro'))).toBe(
      false,
    );
    expect(
      queryResults.documents.nodes.every((node) =>
        node.sources.every((source) => !source.path.startsWith('.skaro/')),
      ),
    ).toBe(true);
    expect(queryResults.languages.nodes.length).toBeGreaterThan(0);
    expect(
      queryResults.languages.nodes.every((node) =>
        ['python', 'svelte'].includes(String(node.attributes.language)),
      ),
    ).toBe(true);
    await page.getByRole('button', { name: 'Перестроить граф', exact: true }).click();
    const notice = page.locator('.graph-notice').filter({ hasText: 'Граф обновляется в фоне' });
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: 'Скрыть', exact: true }).click();
    await expect(notice).toHaveCount(0);
    await page.screenshot({ path: join(evidence!, 'graph.png') });
    await page.evaluate((id) => window.skaro.invoke('graph.cancel', id), project.id);
    await expect(page.locator('.graph-alert')).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(await fingerprint()).toEqual(before);
    await writeFile(
      join(evidence!, 'defects-results.json'),
      JSON.stringify(
        {
          native: true,
          errors,
          views: model.views.length,
          internalDocumentsHidden: true,
          clipboard: true,
          selectorsScroll: true,
          multiSelect: true,
          layoutSettled: true,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const page = await app.firstWindow();
    await page.screenshot({ path: join(evidence!, 'defects-failure.png') });
    await writeFile(join(evidence!, 'defects-failure.txt'), await page.locator('body').innerText());
    throw error;
  } finally {
    await writeFile(join(evidence!, 'defects-stderr.log'), stderr.join(''));
    await app.evaluate(({ clipboard: target }, text) => target.writeText(text), clipboard);
    await app.close();
  }
});
