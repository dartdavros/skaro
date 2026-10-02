import { expect, test, type Locator } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, tempUserData } from './launch';
import { proposalProject } from './proposal-test-support';
import { ArtifactStore } from '@skaro/core';

async function compareLayout(root: Locator, name: string) {
  const prefix = process.env['SKARO_E2E_PROPOSAL_LAYOUT'];
  if (!prefix) return;
  const layout = await root.evaluate((root) => {
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
    return [...root.querySelectorAll('div,span,button,input,textarea,h2,h3,p')].map((el) => {
      const style = getComputedStyle(el);
      return Object.fromEntries(
        props.map((prop) => [prop, style[prop as keyof CSSStyleDeclaration]]),
      );
    });
  });
  const path = `${prefix}-${name}.json`;
  if (existsSync(path)) expect(layout).toEqual(JSON.parse(readFileSync(path, 'utf8')));
  else writeFileSync(path, JSON.stringify(layout, null, 2));
}

test('preserves proposal cards, document decisions and import selection/application', async () => {
  const userData = tempUserData();
  const { repo } = proposalProject(userData);
  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    await page.locator('.sessions .row').filter({ hasText: 'Proposal review' }).click();
    await expect(page.locator('.proposal')).toHaveCount(5);
    await compareLayout(page.locator('.chat .fd-feed'), 'cards');
    const adr = page.locator('.proposal').filter({ hasText: 'Module decision' });
    await adr.getByRole('button', { name: 'Посмотреть', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').locator('textarea')).toHaveValue(/Use `modules`/);
    await compareLayout(page.getByRole('dialog'), 'adr');
    await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
    const doc = page.locator('.proposal').filter({ hasText: 'brief.md' });
    await doc.getByRole('button', { name: 'Применить', exact: true }).click();
    await expect
      .poll(() => readFileSync(join(repo, '.skaro', 'brief.md'), 'utf8'))
      .toContain('Proposal brief');
    await doc.getByRole('button', { name: 'Откатить', exact: true }).click();
    await expect.poll(() => existsSync(join(repo, '.skaro', 'brief.md'))).toBe(false);
    await page.getByRole('button', { name: 'Проверить и импортировать', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Проверка импорта', exact: true });
    await expect(review).toBeVisible();
    await compareLayout(review, 'import');
    const milestone = review.locator('.rows .row').filter({ hasText: 'Этап импорта' });
    await milestone.getByRole('checkbox').click();
    const task = review.locator('.rows .row').filter({ hasText: 'Задача импорта' });
    await expect(task.getByRole('checkbox')).not.toBeChecked();
    await task.getByRole('checkbox').click();
    await expect(task.locator('.dangling')).toBeVisible();
    await task.getByRole('checkbox').click();
    await review.getByRole('button', { name: /Не перенесено/ }).click();
    await expect(review.getByText('diagram.vsdx', { exact: true })).toBeVisible();
    await page.screenshot({ path: join(__dirname, '..', 'test-results', 'import-review.png') });
    await review.getByRole('button', { name: 'Импортировать выбранное', exact: true }).click();
    await expect(review).toHaveCount(0);
    expect(readFileSync(join(repo, '.skaro', 'brief.md'), 'utf8')).toContain('Imported brief');
    expect(readFileSync(join(repo, '.skaro', 'architecture.md'), 'utf8')).toContain('Architecture');
    expect(existsSync(join(repo, '.skaro', 'docs', 'glossary.md'))).toBe(true);
    const store = new ArtifactStore(repo);
    await adr.getByRole('button', { name: 'Принять', exact: true }).click();
    const spec = page.locator('.proposal').filter({ hasText: 'Feature specification' });
    await spec.getByRole('button', { name: 'Принять', exact: true }).click();
    await expect
      .poll(async () => (await store.load()).adrs.find((a) => a.title === 'Module decision')?.id)
      .toBe('0002');
    await expect
      .poll(
        async () => (await store.load()).specs.find((s) => s.title === 'Feature specification')?.id,
      )
      .toBe('0002');
    const plan = page.locator('.proposal').filter({ hasText: 'Proposed task' });
    await plan.getByRole('checkbox').click();
    await expect(plan.locator('.btn.primary')).toBeDisabled();
    await plan.getByRole('checkbox').click();
    await plan.locator('.btn.primary').click();
    await expect
      .poll(
        async () => (await store.load()).tasks.find((t) => t.title === 'Proposed task')?.milestone,
      )
      .toBe('M01');
    expect((await store.load()).milestones.find((m) => m.id === 'M01')?.title).toBe(
      'Proposed milestone',
    );
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
