import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppDb } from '@skaro/core';
import { launchApp, noAgents, noAgentsReason, tempUserData } from './launch';
import { makeRepo } from './agent-task-support';

test.skip(noAgents, noAgentsReason);

test('preserves project grid, list, filtering and missing-folder actions', async () => {
  const userData = tempUserData();
  const repo = makeRepo(userData);
  const db = AppDb.open(join(userData, 'skaro.db'));
  db.addProject({ name: 'Calc', path: repo });
  db.addProject({ name: 'Missing project', path: join(userData, 'missing') });
  db.setSetting('ui.locale', 'ru');
  db.close();
  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.locator('.projects .grid > .card')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Найти заново', exact: true })).toBeVisible();
    const compare = process.env['SKARO_E2E_PROJECTS_LAYOUT'];
    for (const view of ['grid', 'list'] as const) {
      if (view === 'list') await page.getByRole('radio', { name: 'Список', exact: true }).click();
      const layout = await page.locator('.projects').evaluate((root) => {
        const props = [
          'display',
          'fontSize',
          'fontFamily',
          'fontWeight',
          'lineHeight',
          'color',
          'backgroundColor',
          'padding',
          'margin',
          'gap',
          'borderRadius',
          'gridTemplateColumns',
          'alignItems',
        ];
        return [...root.querySelectorAll('div,span,button,input')].map((el) => {
          const style = getComputedStyle(el);
          return Object.fromEntries(
            props.map((prop) => [prop, style[prop as keyof CSSStyleDeclaration]]),
          );
        });
      });
      if (compare) {
        const path = `${compare}-${view}.json`;
        if (existsSync(path)) expect(layout).toEqual(JSON.parse(readFileSync(path, 'utf8')));
        else writeFileSync(path, JSON.stringify(layout, null, 2));
      }
      await page.screenshot({
        path: join(__dirname, '..', 'test-results', `projects-${view}.png`),
      });
    }
    await page.getByPlaceholder('Поиск по названию или пути').fill('Calc');
    await expect(page.locator('.projects .item-row')).toHaveCount(1);
    await page.getByPlaceholder('Поиск по названию или пути').fill('no-such-project');
    await expect(page.locator('.projects .nothing')).toBeVisible();
    await page.getByPlaceholder('Поиск по названию или пути').fill('');
    await expect(page.locator('.projects .item-row')).toHaveCount(2);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
