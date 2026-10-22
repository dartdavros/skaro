import { expect, test } from '@playwright/test';
import type { SkaroApi } from '../src/shared/ipc';
import { launchApp, tempUserData } from './launch';

declare const window: Window & { skaro: SkaroApi };

test('hides the native window without stopping the backend and persists close-to-tray preference', async ({
  browserName: _browserName,
}, info) => {
  const profile = tempUserData();
  let app = await launchApp(profile);
  let closed = false;
  const errors: string[] = [];
  try {
    let page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator('.bar').waitFor();
    await page.evaluate(() => window.skaro.invoke('app.setLocale', 'ru'));
    await page.reload();
    await page.locator('.bar button[data-tip="Настройки"]').click();
    await page.locator('.set-nav button').filter({ hasText: 'Внешний вид' }).click();
    const preference = page.getByRole('switch', { name: 'При закрытии сворачивать в трей' });
    await expect(preference).toBeChecked();
    const version = await page.evaluate(() => window.skaro.invoke('app.version'));
    const renderer = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId(),
    );
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible()),
      )
      .toBe(false);
    expect(await page.evaluate(() => window.skaro.invoke('app.version'))).toBe(version);
    await app.evaluate(({ app }) => app.emit('second-instance', {}, [], ''));
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible()),
      )
      .toBe(true);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId(),
      ),
    ).toBe(renderer);
    await expect(preference).toBeChecked();
    for (const width of [1500, 960]) {
      await app.evaluate(
        ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setContentSize(width, 800),
        width,
      );
      await page.screenshot({ path: info.outputPath(`tray-setting-${width}.png`) });
    }
    await preference.click();
    await expect
      .poll(() => page.evaluate(() => window.skaro.invoke('app.getSetting', 'window.closeToTray')))
      .toBe(false);
    await app.close();
    closed = true;
    app = await launchApp(profile);
    closed = false;
    page = await app.firstWindow();
    await expect(
      page.getByRole('switch', { name: 'При закрытии сворачивать в трей' }),
    ).not.toBeChecked();
    await page.screenshot({ path: info.outputPath('tray-setting-restored.png') });
    await Promise.all([
      app.waitForEvent('close'),
      app.evaluate(({ BrowserWindow }) => {
        setTimeout(() => BrowserWindow.getAllWindows()[0]!.close(), 0);
      }),
    ]);
    closed = true;
    expect(errors).toEqual([]);
  } finally {
    if (!closed) await app.close();
  }
});
