import { expect, test } from '@playwright/test';
import { launchApp } from './launch';

test('opens the main window', async () => {
  const app = await launchApp();
  const window = await app.firstWindow();

  await expect(window).toHaveTitle('Skaro');
  await expect(window.getByRole('heading', { name: 'Skaro' })).toBeVisible();

  // Renderer is isolated: no Node globals leak into the page.
  const hasNode = await window.evaluate(() => 'require' in globalThis || 'process' in globalThis);
  expect(hasNode).toBe(false);

  await app.close();
});
