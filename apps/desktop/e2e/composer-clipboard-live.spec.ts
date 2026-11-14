import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { SkaroApi } from '../src/shared/ipc';
import { launchApp } from './launch';

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
    expect(await page.evaluate(() => window.skaro.invoke('files.pasteImage'))).toBeUndefined();
    await page.screenshot({ path: testInfo.outputPath('before-image.png') });

    const source = join(__dirname, '..', 'build', 'icon.png');
    const expected = await app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }, path) => {
      const image = nativeImage.createFromPath(path);
      if (image.isEmpty()) throw new Error('App icon is unavailable');
      await clipboard.write([
        new ClipboardItem({
          'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }),
        }),
      ]);
      return { png: image.toPNG().toString('base64'), size: image.getSize() };
    }, source);
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
    const stored = await page.evaluate(() => window.skaro.invoke('files.pasteImage'));
    expect(stored?.kind).toBe('image');
    expect(stored?.image?.mime).toBe('image/png');
    await expect(thumbs.locator('img')).toHaveAttribute(
      'src',
      `skaro-media://attachment/${stored!.image!.id}.png`,
    );
    expect(readFileSync(stored!.path).toString('base64')).toBe(expected.png);
    expect(
      await thumbs.locator('img').evaluate((img: HTMLImageElement) => ({
        width: img.naturalWidth,
        height: img.naturalHeight,
      })),
    ).toEqual(expected.size);
    await thumbs.hover({ position: { x: 10, y: 20 } });
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toHaveText(basename(stored!.path));
    expect(await tooltip.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath('after-image.png') });

    await input.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
    // The native IPC round trip above also exercises content-addressed storage.
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
  } finally {
    await app.evaluate(({ clipboard }, saved) => clipboard.write(saved), original);
    await original.dispose();
    await app.close();
  }
});
