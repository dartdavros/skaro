import { expect, test } from '@playwright/test';
import { launchApp } from './launch';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env.SKARO_RESPONSIVENESS_PROFILE;
const project = process.env.SKARO_VERIFICATION_PROJECT;
test.skip(!profile || !project, 'Requires the registered Cat-pilot and scoped real profile');

test('shows C4 diagrams only in the C4 section on the real project', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(180_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    await page.evaluate(async (id) => {
      const projects = await window.skaro.invoke('projects.list');
      if (projects.length !== 1 || projects[0]?.id !== id)
        throw new Error('Verification is not scoped to Cat-pilot');
      await window.skaro.invoke('tabs.set', { projects: [id], active: id });
    }, project!);
    await page.reload();
    await page.getByRole('tab').filter({ hasText: 'Cat-pilot' }).click();
    const nav = page.locator('.project-nav');
    await nav.getByRole('button', { name: /^Документы/ }).click();
    const tree = page.locator('[data-doc-tree].tree');
    await expect(tree).toBeVisible();
    const diagrams = page.locator('[data-c4-preview], .c4-viewer, .md-c4, .c4-document-section');
    for (const title of ['Архитектура', 'Бриф']) {
      await tree.getByRole('treeitem').filter({ hasText: title }).first().click();
      await expect(page.locator('[data-doc-page] article')).toBeVisible();
      await expect(diagrams).toHaveCount(0);
    }
    for (const kind of ['adr', 'spec'] as const) {
      const docs = await page.evaluate(
        ({ id, kind }) => window.skaro.invoke('docs.page', id, kind, 0),
        { id: project!, kind },
      );
      expect(docs.length).toBeGreaterThan(0);
      const doc = docs[0]!;
      const group = tree
        .locator('.group')
        .filter({ hasText: kind === 'adr' ? 'ADR' : 'Спецификации' });
      if (!(await group.locator('.chev.open').count())) await group.click();
      const code = kind === 'adr' ? doc.adr!.id : doc.spec!.id;
      await tree.getByRole('treeitem').filter({ hasText: code }).first().click();
      await expect(page.locator('[data-doc-page] article')).toBeVisible();
      await expect(diagrams).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`${kind}-without-c4.png`) });
    }
    await nav.getByRole('button', { name: 'C4', exact: true }).click();
    const gallery = page.locator('[data-c4-gallery]');
    await expect(gallery).toBeVisible();
    await gallery.getByRole('button', { name: 'Плитка', exact: true }).click();
    await expect(gallery.locator('.c4-preview-svg').first()).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: info.outputPath('c4-gallery.png') });
    await gallery.locator('[data-c4-preview]').first().click();
    await expect(page.locator('[data-c4-element]').first()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: info.outputPath('c4-workspace.png') });
    await nav.getByRole('button', { name: /^Документы/ }).click();
    await expect(tree).toBeVisible();
    await expect(diagrams).toHaveCount(0);
  } finally {
    await app.close();
  }
});
