import { expect, test } from '@playwright/test';
import { launchApp } from './launch';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };

test('shows the application logo, real version and project links without clipping', async ({
  browserName: _browserName,
}, info) => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator('.bar button[data-tip="Настройки"]').click();
    await page.locator('.set-nav button').filter({ hasText: 'О программе' }).click();
    const about = page.locator('.about');
    const targets = [
      'https://help.skaro.dev/',
      'https://skaro.dev',
      'https://github.com/dartdavros/skaro/issues',
      'https://ermolaev.tech',
    ];
    await expect(about.getByRole('heading', { name: 'Skaro' })).toBeVisible();
    await expect(about.locator('a')).toHaveCount(targets.length);
    for (const [index, href] of targets.entries()) {
      await expect(about.locator('a').nth(index)).toHaveAttribute('href', href);
    }
    await expect(about.getByRole('link', { name: /Andrey Ermolaev/ })).toContainText('Автор');
    await expect(about.getByRole('button', { name: 'Выгрузить диагностику' })).toBeVisible();
    await expect(about.locator('.update button')).toBeVisible();
    await expect(about.locator('.version')).toHaveText(
      await page.evaluate(() => window.skaro.invoke('app.version')),
    );
    await expect
      .poll(() => about.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);

    for (const width of [1500, 960]) {
      await app.evaluate(
        ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setContentSize(width, 800),
        width,
      );
      await expect(about).toBeInViewport();
      const clipped = await about.evaluate((element) =>
        [...element.querySelectorAll('a, button, img')].some((child) => {
          const rect = child.getBoundingClientRect();
          return rect.left < 0 || rect.right > innerWidth || child.scrollWidth > child.clientWidth;
        }),
      );
      expect(clipped).toBe(false);
      await page.screenshot({ path: info.outputPath(`about-ru-${width}.png`) });
    }

    await page.evaluate(() => window.skaro.invoke('app.setLocale', 'en'));
    await page.reload();
    await expect(page.locator('.about')).toBeVisible();
    await expect(about.getByRole('link', { name: /Help center/ })).toBeVisible();
    await expect(about.getByRole('link', { name: /Report an issue/ })).toBeVisible();
    await expect(about.getByRole('link', { name: /Andrey Ermolaev/ })).toContainText('Author');
    await page.screenshot({ path: info.outputPath('about-en-960.png') });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
