import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertLiveProfileBoundary } from './live-profile-boundary';

const appDir = join(__dirname, '..');
const ci = !!process.env['CI'];

/** Packaged binary produced by `electron-builder --dir` for the current OS. */
function packagedExecutable(): string {
  const explicit = process.env['SKARO_E2E_EXECUTABLE'];
  if (explicit) return explicit;
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

/** Without a ready agent the app stays on Settings, so project screens need installed agents. */
export const noAgents = !process.env['SKARO_AGENTS_DIR'];
export const noAgentsReason = 'SKARO_AGENTS_DIR with installed agents is not set';

/** Exercise the actual shutdown path even when the live profile has a busy confirmation. */
export async function closeLiveApp(app: ElectronApplication): Promise<void> {
  const child = app.process();
  if (child.exitCode !== null || child.signalCode !== null) return;
  let trace = '';
  const capture = (chunk: Buffer) => (trace = (trace + chunk.toString()).slice(-4000));
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  try {
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(55_000) });
    await app.evaluate(({ powerMonitor }) => {
      setImmediate(() => powerMonitor.emit('shutdown'));
    });
    await exited;
  } catch (error) {
    if (trace) console.error(trace);
    throw error;
  } finally {
    child.stdout?.off('data', capture);
    child.stderr?.off('data', capture);
  }
}

/** A fresh app data dir for one test. */
export function tempUserData(): string {
  return mkdtempSync(join(tmpdir(), 'skaro-e2e-'));
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
export async function launchApp(
  userData: string = tempUserData(),
  { openSavedProject = true }: { openSavedProject?: boolean } = {},
): Promise<ElectronApplication> {
  assertLiveProfileBoundary(userData);
  // Feature tests explicitly navigate to their saved project through the real UI.
  // Startup tests opt out to observe the application's Home screen unchanged.
  const savedProject = openSavedProject ? activeProjectIndex(userData) : undefined;
  const env = { ...process.env, SKARO_USER_DATA: userData } as Record<string, string>;
  if (ci) env['SKARO_TRACE'] = '1';
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
    });
  }
  if (savedProject !== undefined) {
    try {
      const page = await app.firstWindow();
      await page.getByRole('tab').nth(savedProject).click({ timeout });
    } catch (error) {
      await app.close();
      throw error;
    }
  }
  return app;
}

function activeProjectIndex(userData: string): number | undefined {
  const path = join(userData, 'skaro.db');
  if (!existsSync(path)) return;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tabs = db
      .prepare(
        'SELECT open_tabs.active FROM open_tabs JOIN projects ON projects.id = open_tabs.project_id ORDER BY open_tabs.position',
      )
      .all() as { active: number }[];
    const index = tabs.findIndex((tab) => tab.active === 1);
    return index < 0 ? undefined : index;
  } finally {
    db.close();
  }
}
