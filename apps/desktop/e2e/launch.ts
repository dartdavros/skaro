import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const appDir = join(__dirname, '..');

/** Packaged binary produced by `electron-builder --dir` for the current OS. */
function packagedExecutable(): string {
  const release = join(appDir, 'release');
  switch (process.platform) {
    case 'win32':
      return join(release, 'win-unpacked', 'Skaro.exe');
    case 'darwin': {
      const dir = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
      return join(release, dir, 'Skaro.app', 'Contents', 'MacOS', 'Skaro');
    }
    default:
      return join(release, 'linux-unpacked', 'skaro');
  }
}

/** A fresh app data dir for one test. */
export function tempUserData(): string {
  return mkdtempSync(join(tmpdir(), 'skaro-e2e-'));
}

/**
 * Launches the built app from `out/` or, with SKARO_E2E_PACKAGED=1, the packaged app from
 * `release/`. Each test gets its own data dir.
 */
export async function launchApp(userData: string = tempUserData()): Promise<ElectronApplication> {
  const env = { ...process.env, SKARO_USER_DATA: userData } as Record<string, string>;
  const app =
    process.env['SKARO_E2E_PACKAGED'] === '1'
      ? await electron.launch({ executablePath: packagedExecutable(), env })
      : await electron.launch({ args: [appDir], env });
  // The main process output goes to the test log (errors that never reach the window).
  if (process.env['CI']) {
    app.process().stdout?.on('data', (d: Buffer) => process.stdout.write(`[main] ${String(d)}`));
    app.process().stderr?.on('data', (d: Buffer) => process.stdout.write(`[main!] ${String(d)}`));
  }
  return app;
}
