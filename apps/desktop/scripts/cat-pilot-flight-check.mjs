// Genuine static Cat-pilot via file:// and installed Playwright. No backend/server or page replacement.
/* global requestAnimationFrame */
import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chromium, firefox, webkit } from '@playwright/test';
import { measureCatPilotFlight } from './cat-pilot-flight-measure.mjs';
import { checkCatPilotDelivery, checkCatPilotControls } from './cat-pilot-controls-check.mjs';

assert(
  process.argv.length === 3 || process.argv.length === 4,
  'Usage: cat-pilot-flight-check.mjs CAT_PILOT_CHECKOUT [background|controls]',
);
assert(process.argv[3] === undefined || ['background', 'controls'].includes(process.argv[3]));
const root = await realpath(resolve(process.argv[2]));
const expected = await realpath(
  fileURLToPath(new URL('../../../../../TestProject/Test Project/', import.meta.url)),
);
const common = async (folder) =>
  realpath(
    execFileSync('git', ['-C', folder, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim(),
  );
assert.equal(
  await common(root),
  await common(expected),
  'Only the actual Cat-pilot repository/checkouts are permitted',
);
const delivery = process.argv[3] === 'controls' ? await checkCatPilotDelivery(root) : undefined;
const engines = process.argv[3] === 'controls' ? [chromium, firefox, webkit] : [chromium];
for (const engine of engines) {
  const browser = await engine.launch({
    headless: true,
    ...(engine === chromium ? { channel: 'chrome' } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // A static document has no external services. Fail unexpected page network access.
    await page.route(/^https?:/, (route) => route.abort('blockedbyclient'));
    page.on('request', (request) => {
      if (/^https?:/.test(request.url()))
        errors.push(`Unexpected external resource: ${request.url()}`);
    });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(pathToFileURL(join(root, 'index.html')).href);
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const result =
      process.argv[3] === 'controls'
        ? await checkCatPilotControls(page)
        : process.argv[3] === 'background'
          ? await createRequire(import.meta.url)(join(root, 'checks/scene-animation.cjs'))(page)
          : await page.evaluate(measureCatPilotFlight);
    console.log(
      JSON.stringify({
        ...result,
        engine: engine.name(),
        ...(delivery ? { delivery } : {}),
        pageErrors: errors,
      }),
    );
    if (result.failures?.length || errors.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
