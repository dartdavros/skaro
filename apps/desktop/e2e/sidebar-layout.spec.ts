// Opt-in UI verification with an actual Skaro database snapshot and real project artifacts.
import { expect, test, type Page, type ElectronApplication } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import type { SkaroApi } from '../src/shared/ipc';
import { launchApp } from './launch';

declare const window: Window & { skaro: SkaroApi };
const userData = process.env['SKARO_LAYOUT_USER_DATA'];
const projectId = process.env['SKARO_LAYOUT_PROJECT_ID'];
const taskId = process.env['SKARO_LAYOUT_TASK_ID'];
test.skip(
  !userData || !projectId || !taskId,
  'Requires an actual project and an isolated live-data snapshot',
);

async function openTask(page: Page): Promise<void> {
  await page.locator('.project-nav').getByRole('button', { name: 'Задачи' }).click();
  const title = await page.evaluate(
    async ({ projectId, taskId }) =>
      (await window.skaro.invoke('tasks.list', projectId)).find((task) => task.id === taskId)
        ?.title,
    { projectId: projectId!, taskId: taskId! },
  );
  expect(title, 'The real task must exist').toBeTruthy();
  await page
    .locator('.board .card')
    .filter({ has: page.locator('.title', { hasText: title! }) })
    .click();
  await expect(page.locator('.task-conversation textarea')).toBeVisible();
}

async function rect(page: Page, selector: string) {
  const value = await page.locator(selector).boundingBox();
  expect(value).not.toBeNull();
  return value!;
}

async function capture(app: ElectronApplication, path: string): Promise<void> {
  // Capture the real hidden window without depending on CDP's compositor frame scheduling.
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0]!.webContents.capturePage(undefined, {
      stayHidden: true,
      stayAwake: true,
    });
    return image.toPNG().toString('base64');
  });
  writeFileSync(path, Buffer.from(png, 'base64'));
}

async function expectOrder(page: Page): Promise<void> {
  const nav = await rect(page, '.project-nav');
  const conversation = await rect(page, '.task-conversation');
  const description = await rect(page, '.desc-col');
  expect(nav.x).toBe(0);
  expect(conversation.x).toBeCloseTo(nav.x + nav.width + (nav.width === 56 ? 0 : 1), 0);
  expect(description.x).toBeCloseTo(conversation.x + conversation.width + 1, 0);
  expect(description.x + description.width).toBeCloseTo(await page.evaluate(() => innerWidth), 0);
  expect(await page.locator('.project').evaluate((node) => node.firstElementChild?.tagName)).toBe(
    'NAV',
  );
  expect(
    await page
      .locator('.task')
      .evaluate((node) => node.lastElementChild?.classList.contains('desc-col')),
  ).toBe(true);
}

// Electron supplies its own page; the empty fixture pattern is required to receive testInfo.
// eslint-disable-next-line no-empty-pattern
test('keeps project navigation left and task details right through resize, collapse, navigation and restart', async ({}, testInfo) => {
  test.setTimeout(180_000);
  let app = await launchApp(userData!);
  let page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.webContents.setBackgroundThrottling(false);
      window.hide();
      window.setSize(1412, 982);
    });
    await page.evaluate(async (projectId) => {
      await window.skaro.invoke('tabs.set', { projects: [projectId], active: projectId });
      await window.skaro.invoke('app.setSetting', 'ui.locale', 'ru');
      await window.skaro.invoke('app.setSetting', 'ui.navCollapsed', false);
      await window.skaro.invoke('app.setSetting', 'ui.navWidth', 216);
      await window.skaro.invoke('app.setSetting', 'ui.taskDesc', { open: true, width: 318 });
      await window.skaro.invoke('app.setSetting', `tasks.${projectId}.view`, 'board');
    }, projectId!);
    await page.reload();
    await expect(page.locator('.project-nav.panel')).toBeVisible();
    await openTask(page);
    await expectOrder(page);
    await expect(page.locator('.desc-col')).toHaveCSS('width', '318px');
    await expect(page.locator('.desc-col')).toHaveCSS(
      'background-color',
      await page
        .locator('.task-conversation')
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    );
    await expect(page.locator('.project-nav .title')).toHaveCSS('text-transform', 'none');
    await expect(page.locator('.project-nav .item .icon svg').first()).toHaveAttribute(
      'width',
      '17',
    );
    await expect(page.locator('.task-conversation textarea')).toBeVisible();
    const navSeparator = page.locator('[data-panel-side="left"]').getByRole('separator');
    const navGrip = await rect(page, '[data-panel-side="left"] .grip');
    await page.mouse.move(navGrip.x + navGrip.width / 2, navGrip.y + 120);
    await page.mouse.down();
    await page.mouse.move(navGrip.x + navGrip.width / 2 + 84, navGrip.y + 120, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('.project-nav.panel')).toHaveCSS('width', '300px');
    await navSeparator.press('Shift+ArrowLeft');
    await expect(navSeparator).toHaveAttribute('aria-valuenow', '290');
    await navSeparator.press('Home');
    await expect(page.locator('.project-nav.panel')).toHaveCSS('width', '180px');
    await navSeparator.press('End');
    await expect(page.locator('.project-nav.panel')).toHaveCSS('width', '520px');
    await navSeparator.press('Home');
    for (let step = 0; step < 12; step++) await navSeparator.press('Shift+ArrowRight');
    await expect(page.locator('.project-nav.panel')).toHaveCSS('width', '300px');
    await navSeparator.evaluate((node) => (node as HTMLElement).blur());
    await capture(app, testInfo.outputPath('task-sidebars.png'));

    const grip = await rect(page, '.task .grip');
    await page.mouse.move(grip.x + grip.width / 2, grip.y + 120);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 - 82, grip.y + 120, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('.desc-col')).toHaveCSS('width', '400px');
    const separator = page.locator('.task').getByRole('separator');
    await separator.focus();
    await separator.press('Shift+ArrowLeft');
    await expect(separator).toHaveAttribute('aria-valuenow', '410');
    await separator.press('Home');
    await expect(page.locator('.desc-col')).toHaveCSS('width', '240px');
    await separator.press('End');
    await expect(page.locator('.desc-col')).toHaveCSS('width', '520px');
    await separator.press('Shift+ArrowRight');
    await expect(page.locator('.desc-col')).toHaveCSS('width', '510px');
    const composer = page.locator('.task-conversation textarea');
    await composer.fill('Черновик проверки расположения панелей');

    await page.getByRole('button', { name: 'Свернуть описание', exact: true }).click();
    await expect(page.locator('.desc-col')).toHaveCount(0);
    const restore = page.getByRole('button', { name: 'Показать описание задачи', exact: true });
    const restoreBox = await restore.boundingBox();
    const conversationBox = await rect(page, '.task-conversation');
    expect(restoreBox!.x).toBeGreaterThan(conversationBox.x + conversationBox.width - 50);
    await restore.click();
    await expect(page.locator('.desc-col')).toHaveCSS('width', '510px');
    await expect(composer).toHaveValue('Черновик проверки расположения панелей');

    await page
      .locator('.project-nav')
      .getByRole('button', { name: 'Свернуть панель', exact: true })
      .click();
    await expect(page.locator('.project-nav.rail')).toHaveCSS('width', '56px');
    await expect(page.locator('.project-nav.rail')).toHaveCSS('padding-left', '12px');
    await expect(page.locator('.project-nav .rail-item svg').first()).toHaveAttribute(
      'width',
      '17',
    );
    await expect(page.locator('[data-panel-side="left"]')).toHaveCount(0);
    await expectOrder(page);
    await page
      .locator('.project-nav')
      .getByRole('button', { name: 'Развернуть панель', exact: true })
      .click();
    await expect(page.locator('.project-nav.panel')).toHaveCSS('width', '300px');
    await expect(composer).toHaveValue('Черновик проверки расположения панелей');
    await composer.fill('');
    await page.getByRole('button', { name: 'Свернуть описание', exact: true }).click();

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(960, 700));
    await restore.click();
    await separator.press('Home');
    await expectOrder(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
      await page.evaluate(() => innerWidth),
    );
    await separator.evaluate((node) => (node as HTMLElement).blur());
    await capture(app, testInfo.outputPath('task-sidebars-narrow.png'));

    for (const label of ['Документы', 'План', 'Чат', 'Параметры', 'Задачи']) {
      await page.locator('.project-nav').getByRole('button', { name: label }).click();
      expect((await rect(page, '.project-nav')).x).toBe(0);
      await expect(page.locator('.project-nav.panel')).toHaveCSS('width', '300px');
      await expect(page.locator('.project-nav [aria-current="page"] .label')).toHaveText(label);
    }
    await openTask(page);
    await expect(page.locator('.desc-col')).toHaveCSS('width', '240px');
    await page.getByRole('button', { name: 'Свернуть описание', exact: true }).click();
    await page
      .locator('.project-nav')
      .getByRole('button', { name: 'Свернуть панель', exact: true })
      .click();
    await app.close();
    app = await launchApp(userData!);
    page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.hide());
    await expect(page.locator('.project-nav.rail')).toHaveCSS('width', '56px');
    await openTask(page);
    await expect(page.locator('.desc-col')).toHaveCount(0);
    await page.getByRole('button', { name: 'Показать описание задачи', exact: true }).click();
    await expect(page.locator('.desc-col')).toHaveCSS('width', '240px');
    await expectOrder(page);
    await page
      .locator('.project-nav')
      .getByRole('button', { name: 'Развернуть панель', exact: true })
      .click();
    await expect(page.locator('.project-nav.panel')).toHaveCSS('width', '300px');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
