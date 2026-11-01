import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';
import type { BuiltinVerificationDependency } from '@skaro/timeline';

/** Actual host files for fixed local probes, not a claim to measure all runtime dependencies. */
export async function commandDependencies(): Promise<BuiltinVerificationDependency[]> {
  const env = cleanCommandEnvironment();
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (process.platform !== 'win32' || !systemRoot)
    throw new Error('Windows verification host required');
  const found = await promisify(execFile)(join(systemRoot, 'System32', 'where.exe'), ['git.exe'], {
    env,
    windowsHide: true,
  });
  const git = found.stdout.split(/\r?\n/).find((line) => line.trim());
  if (!git) throw new Error('Installed Git not found');
  const paths = [
    ['host-runtime', process.execPath],
    ['powershell', join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')],
    ['git-launcher', git.trim()],
    ['command-worker', resolve('apps/desktop/out/main/agent-command-worker.js')],
  ];
  return Promise.all(paths.map(async ([id, path]) => ({ id: id!, path: await realpath(path!) })));
}

export async function browserDependencies(): Promise<BuiltinVerificationDependency[]> {
  const require = createRequire(join(__dirname, 'package.json'));
  const mcp = require.resolve('@playwright/mcp/package.json');
  const paths = [
    ['browser-host', process.execPath],
    ['browser-mcp-manifest', mcp],
    ['browser-mcp-entry', join(dirname(mcp), 'cli.js')],
    [
      'chrome',
      join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    ],
  ];
  return Promise.all(paths.map(async ([id, path]) => ({ id: id!, path: await realpath(path!) })));
}
