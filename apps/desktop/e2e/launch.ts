import { _electron as electron, type ElectronApplication } from '@playwright/test';
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

/**
 * Launches the built app from `out/` or, with SKARO_E2E_PACKAGED=1,
 * the packaged app from `release/`.
 */
export function launchApp(): Promise<ElectronApplication> {
  if (process.env['SKARO_E2E_PACKAGED'] === '1') {
    return electron.launch({ executablePath: packagedExecutable() });
  }
  return electron.launch({ args: [appDir] });
}
