import { app } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';
import type { BuiltinVerificationDependency } from '@skaro/timeline';

/** Actual fixed host files only. Arbitrary check dependencies remain explicitly unresolved. */
export async function productVerificationDependencies(
  signal: AbortSignal,
  entryDirectory = join(app.getAppPath(), 'out/main'),
): Promise<BuiltinVerificationDependency[]> {
  const result = [
    {
      id: 'command-worker',
      path: await realpath(join(entryDirectory, 'agent-command-worker.js')),
    },
  ];
  const env = cleanCommandEnvironment();
  const execute = promisify(execFile);
  const names =
    process.platform === 'win32'
      ? ['powershell.exe', 'cmd.exe', 'git.exe', 'node.exe']
      : ['sh', 'bash', 'git', 'node'];
  for (const name of names) {
    signal.throwIfAborted();
    try {
      const found = await execute(
        process.platform === 'win32' ? 'where.exe' : '/usr/bin/which',
        [name],
        { env, signal, windowsHide: true, timeout: 5000 },
      );
      const path = found.stdout.split(/\r?\n/).find((item) => item.trim());
      if (path) result.push({ id: name.replace(/\.exe$/, ''), path: await realpath(path.trim()) });
    } catch (error) {
      signal.throwIfAborted();
      if ((error as { code?: number }).code !== 1) throw error;
    }
  }
  return result.filter(
    (item, index) => result.findIndex((other) => other.path === item.path) === index,
  );
}
