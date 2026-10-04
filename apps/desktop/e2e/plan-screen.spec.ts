import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchApp, noAgents, noAgentsReason, tempUserData } from './launch';
import { planProject } from './plan-test-support';
import { compareBaseline } from './layout-baseline';

/** A pointer drag like the board's: press, pass the 5px threshold, move, check, release. */
async function dragTo(page: Page, from: Locator, to: Locator, during?: () => Promise<void>) {
  const source = (await from.boundingBox())!;
  const target = (await to.boundingBox())!;
  await page.mouse.move(source.x + 150, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + 160, source.y + source.height / 2, { steps: 5 });
  await page.mouse.move(target.x + 150, target.y + 8, { steps: 10 });
  await page.mouse.move(target.x + 155, target.y + 8);
  await during?.();
  await page.mouse.up();
}

test.skip(noAgents, noAgentsReason);

test('keeps the plan layout and relations, archives milestones and drags like the board', async () => {
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
    const menu = async (s: Locator) =>
      s.getByRole('button', { name: 'Действия с этапом', exact: true }).click();
    const item = (name: string) => page.getByRole('menuitem', { name, exact: true });
    const archive = plan.locator('button.all[aria-pressed]');
    const compare = (name: string) =>
      compareBaseline(plan, process.env['SKARO_E2E_PLAN_LAYOUT'], name, true);

    await expect(plan.locator('.stage')).toHaveCount(4);
    await expect(first.locator('.body')).toHaveCount(0);
    await expect(second.locator('.rows > .row')).toHaveCount(1);
    // One way to change the plan: the chat with the agent.
    await expect(plan.locator('.actions button')).toHaveText(['Обсудить с агентом']);
    await expect(archive).toHaveCount(0);
    // "1 из 1" stays on one line.
    expect((await first.locator('.count').boundingBox())!.height).toBeLessThan(20);
    await compare('initial');
    if (process.env['SKARO_E2E_PLAN_SCREENSHOT']) {
      await page.screenshot({ path: process.env['SKARO_E2E_PLAN_SCREENSHOT'] });
    }
    await first.locator('.head').click();
    await second.locator('.rows > .row').hover();
    await expect(first.locator('.rows > .row')).toHaveClass(/related/);
    await compare('related');

    // A task goes to another milestone with a ghost under the pointer and a slot where it lands.
    await dragTo(page, loose.locator('.rows > .row'), empty.locator('.rows'), async () => {
      await expect(plan.locator('.ghost .row')).toBeVisible();
      await expect(empty.locator('.slot')).toBeVisible();
      await expect(empty).toHaveClass(/over/);
    });
    await expect
      .poll(async () => (await store.readTask('T-003').catch(() => undefined))?.milestone)
      .toBe('M03');
    await expect(empty.locator('.rows > .row')).toHaveCount(1);
    await expect(loose).toHaveCount(0);

    // A milestone changes its place the same way.
    await plan.locator('button.all').click();
    await expect(plan.locator('.body')).toHaveCount(0);
    await compare('collapsed');
    await dragTo(page, empty.locator('.head'), first.locator('.head'), async () => {
      await expect(plan.locator('.ghost .stage')).toBeVisible();
      await expect(plan.locator('.stages > .slot')).toBeVisible();
    });
    await expect
      .poll(async () => (await store.load()).milestones.find((m) => m.id === 'M03')?.order)
      .toBe(1);
    await expect(plan.locator('.stage .name').first()).toHaveText('Empty milestone');

    // Started work is archived, not deleted; a milestone with work left is not archived.
    await menu(first);
    await expect(item('Удалить этап…')).toHaveAttribute('aria-disabled', 'true');
    await expect(item('В архив')).not.toHaveAttribute('aria-disabled', 'true');
    await item('В архив').click();
    await expect(first).toHaveCount(0);
    await expect.poll(async () => (await store.readTask('T-001')).archived).toBe(true);
    await menu(second);
    await expect(item('В архив')).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');

    // The archive: archived tasks under their milestone, brought back with the milestone.
    await expect(archive).toHaveAttribute('aria-label', 'Архив этапов · 1');
    await archive.click();
    await expect(plan.locator('.stage')).toHaveCount(1);
    await first.locator('.head').click();
    await expect(first.locator('.rows > .row')).toContainText('Исправить сложение');
    await compare('archive');
    await menu(first);
    await item('Вернуть из архива').click();
    await expect(archive).toHaveCount(0);
    await expect(first).toBeVisible();
    await expect.poll(async () => (await store.readTask('T-001')).archived).toBe(false);

    // A milestone without started tasks is deleted together with them.
    await menu(second);
    await item('Удалить этап…').click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('Вместе с этапом удалится его задача');
    await compareBaseline(confirm, process.env['SKARO_E2E_PLAN_LAYOUT'], 'delete', true);
    await confirm.getByRole('button', { name: 'Отмена', exact: true }).click();
    await expect(second).toBeVisible();
    await menu(second);
    await item('Удалить этап…').click();
    await confirm.getByRole('button', { name: 'Удалить этап', exact: true }).click();
    await expect(second).toHaveCount(0);
    await expect
      .poll(async () => (await store.readTask('T-002').catch(() => undefined))?.id)
      .toBe(undefined);

    await first.locator('.rows > .row').filter({ hasText: 'Исправить сложение' }).click();
    await expect(
      page.getByRole('heading', { name: 'Исправить сложение', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('shows an empty plan with the way to make one', async () => {
  const userData = tempUserData();
  await planProject(userData, true);
  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    await page.getByRole('navigation').getByText('План', { exact: true }).click();
    await expect(page.getByText('Плана пока нет', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Обсудить с агентом', exact: true })).toHaveCount(
      1,
    );
    await expect(page.getByRole('button', { name: 'Новый этап', exact: true })).toHaveCount(0);
  } finally {
    await app.close();
  }
});
