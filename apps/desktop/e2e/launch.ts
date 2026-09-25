import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const appDir = join(__dirname, '..');
const ci = !!process.env['CI'];

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

/** Leftover app processes and the busiest processes on a macOS runner (diagnostics). */
function processSnapshot(label: string): void {
  if (!ci || process.platform !== 'darwin') return;
  try {
    const ps = execFileSync('ps', ['-axro', 'pid,ppid,stat,etime,%cpu,command'], {
      encoding: 'utf8',
    }).split('\n');
    const lines = [...ps.slice(0, 8), ...ps.slice(8).filter((l) => /Skaro/.test(l))];
    process.stdout.write(`[ps ${label}]\n${lines.map((l) => l.slice(0, 200)).join('\n')}\n`);
  } catch (error) {
    process.stdout.write(`[ps ${label}] ${String(error)}\n`);
  }
}

/**
 * Launches the built app from `out/` or, with SKARO_E2E_PACKAGED=1, the packaged app from
 * `release/`. Each test gets its own data dir.
 */
export async function launchApp(userData: string = tempUserData()): Promise<ElectronApplication> {
  const env = { ...process.env, SKARO_USER_DATA: userData } as Record<string, string>;
  if (ci) env['SKARO_TRACE'] = '1';
  processSnapshot('before launch');
  const started = Date.now();
  // A launch that hangs fails with Playwright's call log instead of the bare test timeout.
  const timeout = 90_000;
  const app =
    process.env['SKARO_E2E_PACKAGED'] === '1'
      ? await electron.launch({ executablePath: packagedExecutable(), env, timeout })
      : await electron.launch({ args: [appDir], env, timeout });
  // The main process output goes to the test log (errors that never reach the window).
  if (ci) {
    const pid = app.process().pid;
    process.stdout.write(`[launch] pid ${pid} in ${Date.now() - started} ms\n`);
    app.process().stdout?.on('data', (d: Buffer) => process.stdout.write(`[main] ${String(d)}`));
    app.process().stderr?.on('data', (d: Buffer) => process.stdout.write(`[main!] ${String(d)}`));
    app.process().on('exit', (code, signal) => {
      process.stdout.write(`[launch] pid ${pid} exited: ${code ?? signal}\n`);
      processSnapshot('after exit');
    });
  }
  return app;
}
