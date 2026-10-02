import { expect, test } from '@playwright/test';
import { launchApp, tempUserData } from './launch';
import { planProject } from './plan-test-support';
import { compareBaseline } from './layout-baseline';

test('preserves plan layout, filtering, relations, milestone edits and native dragging', async () => {
  const userData = tempUserData();
  const store = await planProject(userData);
  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    await page.getByRole('navigation').getByText('План', { exact: true }).click();
    const plan = page.locator('.screen').filter({ has: page.locator('.stages') });
    const stage = (name: string) =>
      plan.locator('.stage').filter({ has: page.locator('.name', { hasText: name }) });
    const first = stage('First milestone');
    const second = stage('Second milestone');
    const empty = stage('Empty milestone');
    const loose = stage('Без этапа');
    const compare = (name: string) =>
      compareBaseline(plan, process.env['SKARO_E2E_PLAN_LAYOUT'], name, true);
    await expect(plan.locator('.stage')).toHaveCount(4);
    await expect(first.locator('.body')).toHaveCount(0);
    await expect(second.locator('.rows > .row')).toHaveCount(1);
    await compare('initial');
    if (process.env['SKARO_E2E_PLAN_SCREENSHOT']) {
      await page.screenshot({ path: process.env['SKARO_E2E_PLAN_SCREENSHOT'] });
    }
    await first.locator('.head').click();
    await second.locator('.rows > .row').hover();
    await expect(first.locator('.rows > .row')).toHaveClass(/related/);
    await compare('related');
    await plan.getByRole('checkbox', { name: 'Скрыть готовые' }).click();
    await expect(first.locator('.empty')).toContainText('скрыто 1');
    await compare('hidden');
    await plan.getByRole('checkbox', { name: 'Скрыть готовые' }).click();
    await plan.locator('button.all').click();
    await expect(plan.locator('.body')).toHaveCount(0);
    await compare('collapsed');
    await plan.locator('button.all').click();
    await plan.getByRole('button', { name: 'Новый этап', exact: true }).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByRole('button', { name: 'Создать этап', exact: true })).toBeDisabled();
    await modal.getByLabel('Название', { exact: true }).fill('Created milestone');
    await modal.getByLabel('Цель', { exact: true }).fill('Created goal');
    await modal.getByLabel('Критерий готовности', { exact: true }).fill('Created criterion');
    await compareBaseline(modal, process.env['SKARO_E2E_PLAN_LAYOUT'], 'create', true);
    await modal.getByRole('button', { name: 'Создать этап', exact: true }).click();
    await expect(stage('Created milestone')).toBeVisible();
    await expect
      .poll(
        async () =>
          (await store.load()).milestones.find((m) => m.title === 'Created milestone')?.body,
      )
      .toContain('Created criterion');
    await second.getByRole('button', { name: 'Действия с этапом', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Редактировать', exact: true }).click();
    await expect(modal.getByLabel('Название', { exact: true })).toHaveValue('Second milestone');
    await modal.getByLabel('Название', { exact: true }).fill('Edited milestone');
    await modal.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const edited = stage('Edited milestone');
    await expect(edited).toBeVisible();
    await loose.locator('.rows > .row').dragTo(empty.locator('.empty'));
    await expect
      .poll(async () => (await store.readTask('T-003').catch(() => undefined))?.milestone)
      .toBe('M03');
    await expect(empty.locator('.rows > .row')).toHaveCount(1);
    await first.locator('.head').scrollIntoViewIfNeeded();
    const source = (await empty.locator('.head').boundingBox())!;
    const target = (await first.locator('.head').boundingBox())!;
    await page.mouse.move(source.x + 150, source.y + 15);
    await page.mouse.down();
    await page.mouse.move(source.x + 165, source.y + 15, { steps: 5 });
    await page.mouse.move(target.x + 150, target.y + 15, { steps: 10 });
    await page.mouse.move(target.x + 155, target.y + 15);
    await page.mouse.up();
    await expect
      .poll(async () => (await store.load()).milestones.find((m) => m.id === 'M03')?.order)
      .toBe(1);
    await expect(plan.locator('.stage .name').first()).toHaveText('Empty milestone');
    await edited.getByRole('button', { name: 'Действия с этапом', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Удалить этап…', exact: true }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('Задачи этапа (1) не удалятся');
    await compareBaseline(confirm, process.env['SKARO_E2E_PLAN_LAYOUT'], 'delete', true);
    await confirm.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(edited).toBeVisible();
    await edited.getByRole('button', { name: 'Действия с этапом', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Удалить этап…', exact: true }).click();
    await confirm.getByRole('button', { name: 'Удалить этап', exact: true }).click();
    await expect(edited).toHaveCount(0);
    await expect
      .poll(async () => (await store.readTask('T-002').catch(() => undefined))?.milestone)
      .toBe('M01');
    await first.locator('.rows > .row').filter({ hasText: 'Добавить умножение' }).click();
    await expect(
      page.getByRole('heading', { name: 'Добавить умножение', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('shows an empty plan and transitions to the first created milestone', async () => {
  const userData = tempUserData();
  await planProject(userData, true);
  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    await page.getByRole('navigation').getByText('План', { exact: true }).click();
    await expect(page.getByText('Плана пока нет', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Обсудить с агентом', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Новый этап', exact: true }).click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('Название', { exact: true }).fill('First stage');
    await modal.getByRole('button', { name: 'Создать этап', exact: true }).click();
    await expect(page.locator('.stage .name')).toHaveText('First stage');
    await expect(page.getByText('Плана пока нет', { exact: true })).toHaveCount(0);
    await expect(page.locator('.stage .empty')).toContainText('В этапе пока нет задач');
  } finally {
    await app.close();
  }
});
