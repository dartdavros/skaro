import { expect, test } from '@playwright/test';
import type { SkaroApi } from '../src/shared/ipc';
import { launchApp } from './launch';

declare const window: Window & { skaro: SkaroApi };

/** Real Electron main/preload and live GitHub feed; no routes, seeds or update substitutes. */
test('uses one real update state and protects a dev checkout from installation', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await expect(page).toHaveTitle('Skaro');
    const checked = await page.evaluate(() => window.skaro.invoke('app.checkUpdate'));
    expect(checked.checked).toBe(true);
    expect(checked.phase).not.toBe('error');
    const packaged = await app.evaluate(({ app }) => app.isPackaged);
    if (!packaged) expect(checked.installable).toBe(false);
    if (packaged && process.env['SKARO_BUNDLE_VERSION'] && process.env['SKARO_PRODUCT_VERSION']) {
      expect(await app.evaluate(({ app }) => app.getVersion())).toBe(
        process.env['SKARO_BUNDLE_VERSION'],
      );
      expect(checked.current).toBe(process.env['SKARO_PRODUCT_VERSION']);
    }
    expect(await page.evaluate(() => window.skaro.invoke('app.version'))).toBe(checked.current);
    const state = await page.evaluate(() => window.skaro.invoke('updates.state'));
    expect(state.components).toEqual(checked.components);
    const indicator = page.getByRole('button', { name: /Доступны обновления|Updates available/ });
    if (checked.components.length) {
      await indicator.click();
      const modal = page.getByRole('dialog', { name: /Обновления|Updates/ });
      await expect(modal).toBeVisible();
      expect(await modal.evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(
        440,
      );
      await expect(modal.getByRole('link')).toHaveCount(checked.components.length);
      if (!packaged)
        await expect(modal.getByRole('button', { name: /^Обновить$|^Update$/ })).toBeDisabled();
    } else {
      await expect(indicator).toHaveCount(0);
      await page.getByRole('button', { name: /Настройки|Settings/ }).click();
      await page.getByRole('button', { name: /^(О программе|About)$/ }).click();
      const check = page.getByRole('button', { name: /Проверить обновления|Check for updates/ });
      await expect(check).toBeVisible();
      await check.click();
      await expect(check).toBeEnabled();
      await expect(page.getByRole('dialog', { name: /Обновления|Updates/ })).toHaveCount(0);
    }
    await page.screenshot({ path: 'test-results/updates-real-electron.png' });
  } finally {
    await app.close();
  }
});
