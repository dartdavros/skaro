import { expect, type Page } from '@playwright/test';
import type { C4Model } from '@skaro/core/c4-view';
import { join } from 'node:path';

export async function checkC4Gallery(page: Page, model: C4Model, evidence: string): Promise<void> {
  const gallery = page.locator('[data-c4-gallery]');
  const previous = await page.evaluate(() => localStorage.getItem('skaro.c4.gallery'));
  const cards = gallery.locator('[data-c4-preview]');
  const rows = gallery.locator('[data-c4-row]');
  await gallery.getByRole('button', { name: 'Плитка', exact: true }).click();
  await expect(cards).toHaveCount(model.views.length);
  await expect(cards.first().locator('.preview-header .kind')).toHaveCount(0);
  await expect(cards.first().locator('.preview-footer .kind')).toBeVisible();
  await expect(cards.first().locator('.preview-header svg')).toHaveCount(2);
  const dynamic = model.views.filter((view) => view.kind === 'dynamic');
  expect(dynamic.length).toBeGreaterThan(0);
  await gallery.getByRole('button', { name: 'Тип диаграммы', exact: true }).click();
  await page.getByRole('menuitemcheckbox').filter({ hasText: 'Взаимодействия' }).click();
  await page.keyboard.press('Escape');
  await expect(cards).toHaveCount(dynamic.length);
  await gallery.getByRole('button', { name: 'Состояние', exact: true }).click();
  await page.getByRole('menuitemcheckbox').filter({ hasText: 'Планируемая' }).click();
  await page.keyboard.press('Escape');
  await expect(cards).toHaveCount(dynamic.filter((view) => view.state === 'planned').length);
  await page.screenshot({ path: join(evidence, 'c4-filtered-grid.png') });
  await gallery.getByRole('button', { name: 'Список', exact: true }).click();
  await expect(rows).toHaveCount(dynamic.filter((view) => view.state === 'planned').length);
  await gallery.getByRole('button', { name: 'Сбросить', exact: true }).click();
  await expect(rows).toHaveCount(model.views.length);
  await expect(rows.first().locator('.heading svg')).toHaveCount(1);
  await page.screenshot({ path: join(evidence, 'c4-complete-list.png') });
  await rows.first().click();
  await expect(page.locator('[data-c4-element]').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'C4', exact: true }).click();
  await expect(rows).toHaveCount(model.views.length);
  await gallery.getByRole('button', { name: 'Плитка', exact: true }).click();
  await expect(cards).toHaveCount(model.views.length);
  await cards.first().locator('.c4-preview-svg').waitFor({ timeout: 30_000 });
  await page.screenshot({ path: join(evidence, 'c4-complete-grid.png') });
  if (previous === 'list')
    await gallery.getByRole('button', { name: 'Список', exact: true }).click();
  console.log('C4 gallery verified:', {
    views: model.views.length,
    dynamic: dynamic.length,
    plannedDynamic: dynamic.filter((view) => view.state === 'planned').length,
  });
}
