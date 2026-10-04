// Opt-in browser check on an existing real managed project and signed-in installed agents.
// No project fixtures, replacement backend or direct database seeding.
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { launchApp, tempUserData } from './launch';
import type { SkaroApi } from '../src/shared/ipc';

const projectPath = process.env['SKARO_E2E_PERMISSION_PROJECT'];

test.skip(!projectPath, 'Requires an existing real project with .skaro/');
test('selects chat permissions in the composer and shows one action button while Codex works', async () => {
  test.setTimeout(240_000);
  const userData = tempUserData();
  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.hide();
      window.setSize(1412, 982);
      window.webContents.setBackgroundThrottling(false);
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const project = await page.evaluate(async (path) => {
      const skaro = (window as unknown as { skaro: SkaroApi }).skaro;
      await skaro.invoke('app.setSetting', 'ui.locale', 'ru');
      const info = await skaro.invoke('projects.add', path);
      await skaro.invoke('tabs.set', { projects: [info.id], active: info.id });
      return info;
    }, projectPath!);
    await page.reload();
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    await expect(page.getByText('Чат пока ничего не изменил', { exact: true })).toBeVisible();
    const composer = page.locator('.composer');
    const permission = composer.locator('.pill');
    await expect(permission).toHaveText('Спрашивать');
    await permission.click();
    await expect(composer.locator('.perm-row')).toHaveCount(2);
    await composer.locator('.perm-row').filter({ hasText: 'Полный доступ' }).click();
    await expect(permission).toHaveText('Полный доступ');
    await expect(permission).toHaveClass(/warn/);
    await composer.locator('.model').click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByText('Режим прав', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: join(userData, 'chat-agent-modal.png') });
    await modal.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(modal).not.toBeVisible();
    await expect(permission).toHaveText('Полный доступ');
    // Create through real IPC; the running chat's switch goes through the visible composer.
    await page.evaluate(async (projectId) => {
      const skaro = (window as unknown as { skaro: SkaroApi }).skaro;
      await skaro.invoke(
        'chat.create',
        projectId,
        { agent: 'codex', effort: 'low' },
        {
          text:
            'Проверка переключения прав. Выполни одну команду PowerShell: ' +
            'Invoke-WebRequest -UseBasicParsing -Uri https://example.com | Select-Object -ExpandProperty StatusCode. ' +
            'Для первого запуска запроси повышенные права инструмента: сеть в песочнице недоступна. ' +
            'Файлы проекта не читай и не изменяй, инструменты изменения документов Skaro не вызывай. ' +
            'После успешного выполнения ответь UI_SWITCH_OK.',
        },
      );
    }, project.id);
    await page.locator('.sessions .row').first().click();
    const approval = page
      .locator('.fd-card')
      .filter({ hasText: /Разрешить|разрешение|permission/i });
    await expect(approval.first()).toBeVisible({ timeout: 150_000 });
    await expect(permission).toHaveText('Спрашивать');
    await expect(composer.locator('.stop')).toBeVisible();
    await expect(composer.locator('.send')).toHaveCount(0);
    const input = composer.locator('textarea');
    await input.fill('Уточнение');
    await expect(composer.locator('.send')).toBeVisible();
    await expect(composer.locator('.stop')).toHaveCount(0);
    await page.screenshot({ path: join(userData, 'composer-send-only.png') });
    await input.fill('   ');
    await expect(composer.locator('.stop')).toBeVisible();
    await expect(composer.locator('.send')).toHaveCount(0);
    await input.fill('');
    await permission.click();
    await expect(composer.locator('.perm-row')).toHaveCount(2);
    await expect(composer.locator('.pop.perm')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: join(userData, 'chat-permission-menu.png') });
    await composer.locator('.perm-row').filter({ hasText: 'Полный доступ' }).click();
    await expect(permission).toHaveText('Полный доступ');
    await expect(approval).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('.fd-user')).toHaveCount(1);
    await expect(page.getByText('UI_SWITCH_OK', { exact: true })).toBeVisible({ timeout: 150_000 });
    await expect(page.locator('.fd-bar:not(.warning)')).toHaveCount(2, { timeout: 30_000 });
    await expect(page.locator('.fd-user')).toHaveCount(1);
    await expect(composer.locator('.stop')).toHaveCount(0);
    await expect(composer.locator('.send')).toBeDisabled();
    await page.reload();
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    await page.locator('.sessions .row').first().click();
    await expect(permission).toHaveText('Полный доступ');
    await permission.click();
    await composer.locator('.perm-row').filter({ hasText: 'Спрашивать' }).click();
    await expect(permission).toHaveText('Спрашивать');
    await page.reload();
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    await page.locator('.sessions .row').first().click();
    await expect(permission).toHaveText('Спрашивать');
    await page.getByRole('button', { name: 'Новый чат', exact: true }).click();
    await expect(permission).toHaveText('Спрашивать');
    await page.screenshot({ path: join(userData, 'permission-switch.png') });
    expect(errors).toEqual([]);
    console.log(`Real Skaro browser screenshot: ${join(userData, 'permission-switch.png')}`);
  } finally {
    await app.close();
  }
});
