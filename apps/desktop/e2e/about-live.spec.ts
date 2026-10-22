import { expect, test } from '@playwright/test';
import { launchApp } from './launch';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };

const locales = [
  {
    locale: 'ru',
    settings: 'Настройки',
    about: 'О программе',
    author: 'Автор',
    diagnostics: 'Выгрузить диагностику',
    links: ['Центр помощи', 'Сайт', 'Сообщить о проблеме', 'Andrey Ermolaev'],
  },
  {
    locale: 'en',
    settings: 'Settings',
    about: 'About',
    author: 'Author',
    diagnostics: 'Export diagnostics',
    links: ['Help center', 'Website', 'Report an issue', 'Andrey Ermolaev'],
  },
] as const;

for (const labels of locales) {
  test(`shows the application logo, real version and project links without clipping (${labels.locale})`, async ({
    browserName: _browserName,
  }, info) => {
    const app = await launchApp();
    try {
      const page = await app.firstWindow();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await expect(page.locator('.bar')).toBeVisible();
      // Fresh profiles use the OS language, which can differ between local runs and CI.
      await page.evaluate((locale) => window.skaro.invoke('app.setLocale', locale), labels.locale);
      await page.reload();
      await page.locator(`.bar button[data-tip="${labels.settings}"]`).click();
      await page
        .locator('.set-nav')
        .getByRole('button', { name: labels.about, exact: true })
        .click();
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
        await expect(about.locator('a').nth(index)).toContainText(labels.links[index]!);
      }
      await expect(about.getByRole('link', { name: /Andrey Ermolaev/ })).toContainText(
        labels.author,
      );
      await expect(about.getByRole('button', { name: labels.diagnostics })).toBeVisible();
      await expect(about.locator('.update button')).toBeVisible();
      await expect(about.locator('.version')).toHaveText(
        await page.evaluate(() => window.skaro.invoke('app.version')),
      );
      await expect
        .poll(() => about.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0);

      for (const width of [1500, 960]) {
        await app.evaluate(
          ({ BrowserWindow }, width) =>
            BrowserWindow.getAllWindows()[0]!.setContentSize(width, 800),
          width,
        );
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
        await expect(about).toBeInViewport();
        const clipped = await about.evaluate((element) =>
          [...element.querySelectorAll('a, button, img')].some((child) => {
            const rect = child.getBoundingClientRect();
            return (
              rect.left < 0 || rect.right > innerWidth || child.scrollWidth > child.clientWidth
            );
          }),
        );
        expect(clipped).toBe(false);
        await page.screenshot({ path: info.outputPath(`about-${labels.locale}-${width}.png`) });
      }
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  });
}
