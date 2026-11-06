import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp } from './launch';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_FOLLOW_UP_PROFILE'];
const project = process.env['SKARO_VERIFICATION_PROJECT'];
test.skip(
  !profile || !project || process.env['SKARO_E2E_PACKAGED'] !== '1',
  'Real scoped installed application only',
);

test('opens the installed build with matching code, metadata and restored task agent', async ({
  browserName: _browserName,
}, info) => {
  const expected = createHash('sha256')
    .update(readFileSync(join(__dirname, '../out/main/index.js')))
    .digest('hex');
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const actual = await app.evaluate(({ app }) => {
      const fs = process.getBuiltinModule('fs');
      const path = process.getBuiltinModule('path');
      const crypto = process.getBuiltinModule('crypto');
      return {
        executable: app.getPath('exe'),
        packaged: app.isPackaged,
        version: app.getVersion(),
        scope: process.env['SKARO_VERIFICATION_PROJECT'],
        hash: crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(app.getAppPath(), 'out/main/index.js')))
          .digest('hex'),
      };
    });
    expect(actual.packaged).toBe(true);
    expect(actual.version).toBe('2.2.22');
    expect(actual.scope).toBe(project);
    expect(actual.executable.toLowerCase().replaceAll('\\', '/')).toBe(
      process.env['SKARO_E2E_EXECUTABLE']!.toLowerCase().replaceAll('\\', '/'),
    );
    expect(actual.hash).toBe(expected);
    const page = await app.firstWindow();
    await expect(page.locator('.bar')).toBeVisible();
    expect(await page.evaluate(() => window.skaro.invoke('tabs.get'))).toEqual({
      projects: [project],
      active: project,
    });
    const restored = await page.evaluate(
      (project) => window.skaro.invoke('task.open', project, 'T-006', { paged: true }),
      project!,
    );
    expect(restored.settings.agent).toBe('skaro');
    expect(restored.queued).toBe(false);
    await page.screenshot({ path: info.outputPath('installed-ready.png') });
    console.log(
      JSON.stringify({ installed: true, ...actual, restoredAgent: restored.settings.agent }),
    );
  } finally {
    await app.close();
  }
});
