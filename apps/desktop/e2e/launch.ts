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

/** Keychain items of the app (attributes only, no secrets) on a macOS runner (diagnostics). */
function keychainSnapshot(label: string): void {
  if (!ci || process.platform !== 'darwin') return;
  try {
    const out = execFileSync('security', ['find-generic-password', '-s', 'Skaro Safe Storage'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    process.stdout.write(`[keychain ${label}] item present\n${out}`);
  } catch (error) {
    process.stdout.write(`[keychain ${label}] ${String(error).split('\n')[0]}\n`);
  }
}

/** Native stack of a launch that stalls on a macOS runner (diagnostics). */
function sampleStalledLaunch(started: number): () => void {
  if (!ci || process.platform !== 'darwin') return () => {};
  const timer = setTimeout(() => {
    try {
      const pid = execFileSync('pgrep', ['-n', '-f', 'Skaro.app/Contents/MacOS/Skaro'], {
        encoding: 'utf8',
      }).trim();
      const out = execFileSync('sample', [pid, '3'], { encoding: 'utf8', timeout: 30_000 });
      // The main thread's call graph comes first; keep it readable.
      const lines = out.split('\n');
      const from = lines.findIndex((l) => l.startsWith('Call graph:'));
      process.stdout.write(
        `[sample pid ${pid} at ${Date.now() - started} ms]\n` +
          lines
            .slice(from, from + 160)
            .map((l) => l.slice(0, 220))
            .join('\n') +
          '\n',
      );
    } catch (error) {
      process.stdout.write(`[sample] ${String(error)}\n`);
    }
  }, 10_000);
  return () => clearTimeout(timer);
}

/**
 * Launches the built app from `out/` or, with SKARO_E2E_PACKAGED=1, the packaged app from
 * `release/`. Each test gets its own data dir.
 */
export async function launchApp(userData: string = tempUserData()): Promise<ElectronApplication> {
  const env = { ...process.env, SKARO_USER_DATA: userData } as Record<string, string>;
  if (ci) env['SKARO_TRACE'] = '1';
  processSnapshot('before launch');
  keychainSnapshot('before launch');
  const started = Date.now();
  const stopSampling = sampleStalledLaunch(started);
  // A launch that hangs fails with Playwright's call log instead of the bare test timeout.
  const timeout = 90_000;
  const app = await (
    process.env['SKARO_E2E_PACKAGED'] === '1'
      ? electron.launch({ executablePath: packagedExecutable(), env, timeout })
      : electron.launch({ args: [appDir], env, timeout })
  ).finally(stopSampling);
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
