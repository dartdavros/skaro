import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { SkaroApi } from '../src/shared/ipc';
import { launchApp } from './launch';
import { writeClipboardImage } from './clipboard-native-sources';

declare const window: Window & { skaro: SkaroApi };

// Uses an existing, configured app profile and its real projects/agents. No seeded data.
const userData = process.env['SKARO_E2E_CLIPBOARD_USER_DATA'];
test.skip(!userData, 'Set SKARO_E2E_CLIPBOARD_USER_DATA to a configured native app profile');

test('native image paste preserves text, deduplicates attachments and supports removal', async ({
  playwright: _playwright,
}, testInfo) => {
  const app = await launchApp(userData!);
  const original = await app.evaluateHandle(async ({ clipboard, ClipboardItem }) =>
    Promise.all(
      (await clipboard.read()).map(async (item) => {
        const entries = await Promise.all(
          item.types.map(async (type) => [type, await item.getType(type)] as const),
        );
        return new ClipboardItem(Object.fromEntries(entries));
      }),
    ),
  );
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('navigation')).toBeVisible();
    await page
      .getByRole('navigation')
      .getByText(/^(Чат|Chat)$/)
      .click();
    await page.locator('.sessions .new').click();
    const input = page.locator('.composer textarea');
    const thumbs = page.locator('.composer .thumb');
    await expect(input).toBeVisible();
    await input.fill('Clipboard: ');

    await app.evaluate(({ clipboard }) => clipboard.writeText('plain text'));
    await input.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
    await expect(input).toHaveValue('Clipboard: plain text');
    await expect(thumbs).toHaveCount(0);
    await input.evaluate((element) => element.blur());
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
    await expect(input).toHaveValue('Clipboard: plain text');
    await expect(thumbs).toHaveCount(0);
    expect(await page.evaluate(() => window.skaro.invoke('files.pasteImage'))).toBeUndefined();
    await page.screenshot({ path: testInfo.outputPath('before-image.png') });

    const source = join(__dirname, '..', 'build', 'icon.png');
    // Cold navigation is essential: reloading would conceal late protocol registration.
    for (const clipboardSource of (process.platform === 'win32'
      ? ['png', 'bitmap', 'file-drop']
      : ['png']) as ('png' | 'bitmap' | 'file-drop')[]) {
      const expected = await writeClipboardImage(app, source, clipboardSource);
      await input.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
      await expect(thumbs).toHaveCount(1);
      await expect(input).toHaveValue('Clipboard: plain text');
      await expect(page.locator('.composer .send')).toBeEnabled();
      await expect
        .poll(() =>
          thumbs
            .locator('img')
            .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
        )
        .toBe(true);
      const url = await thumbs.locator('img').getAttribute('src');
      const id = /^skaro-media:\/\/attachment\/([a-f0-9]{64})\.png$/.exec(url ?? '')?.[1];
      expect(id).toBeTruthy();
      const data = await app.evaluate(({ app }) => app.getPath('userData'));
      const stored = join(data, 'attachments', `${id}.png`);
      // Read the actual file; renderer fetch is deliberately restricted by the app's CSP.
      expect(readFileSync(stored).toString('base64')).toBe(expected.png);
      expect(
        await thumbs.locator('img').evaluate((img: HTMLImageElement) => ({
          width: img.naturalWidth,
          height: img.naturalHeight,
        })),
      ).toEqual(expected.size);
      await thumbs.hover({ position: { x: 10, y: 20 } });
      const tooltip = page.getByRole('tooltip');
      await expect(tooltip).toHaveText(basename(stored));
      expect(await tooltip.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath(`after-${clipboardSource}.png`) });

      await input.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
      // Repeating the same native paste must retain the same content identity.
      await expect(thumbs).toHaveCount(1);
      await expect(page.locator('.composer .send')).toBeEnabled();
      await thumbs.locator('.remove-thumb').click();
      await expect(thumbs).toHaveCount(0);
      await expect(input).toHaveValue('Clipboard: plain text');
      await input.fill('');
      await input.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
      await expect(thumbs).toHaveCount(1);
      await expect(page.locator('.composer .send')).toBeEnabled();
      await thumbs.locator('.remove-thumb').click();
      await expect(page.locator('.composer .send')).toBeDisabled();
      await input.fill('Clipboard: plain text');
      // Returning from the system screen-clip overlay can focus the feed instead of textarea.
      if (clipboardSource !== 'file-drop') {
        await input.evaluate((element) => element.blur());
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
        await expect(thumbs).toHaveCount(1);
        await expect
          .poll(() =>
            thumbs
              .locator('img')
              .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
          )
          .toBe(true);
        await expect(input).toHaveValue('Clipboard: plain text');
        await thumbs.locator('.remove-thumb').click();
      }
      await input.fill('@');
      const fileSearch = page.locator('.composer .menu.at input');
      await expect(fileSearch).toBeVisible();
      await fileSearch.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
      // A genuine main-process clipboard round trip settles the pending native work.
      await page.evaluate(() => window.skaro.invoke('files.pasteImage'));
      await expect(thumbs).toHaveCount(0);
      await fileSearch.press('Escape');
      await input.fill('Clipboard: plain text');
    }
  } finally {
    await app.evaluate(({ clipboard }, saved) => clipboard.write(saved), original);
    await original.dispose();
    await app.close();
  }
});
