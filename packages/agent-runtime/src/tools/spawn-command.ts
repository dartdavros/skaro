import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { BuiltinToolScope } from '@skaro/timeline';
import { cleanCommandEnvironment } from './command-env.ts';
import { WINDOWS_COMMAND_JOB } from './windows-job.ts';

export function spawnCommandSupervisor(config: BuiltinToolScope) {
  const entry =
    config.commandEntry ?? fileURLToPath(new URL('./command-worker.ts', import.meta.url));
  if (process.platform !== 'win32') {
    if (!['linux', 'darwin'].includes(process.platform))
      throw new Error('Managed commands are unavailable on this OS');
    // The worker leads a new session/process group. It holds the custody pipe open
    // and kills that group if its runtime disappears. This is not an OS sandbox.
    return spawn(process.execPath, [entry], {
      env: { ...cleanCommandEnvironment(), ELECTRON_RUN_AS_NODE: '1' },
      detached: true,
      stdio: 'pipe',
    });
  }
  return spawn(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(WINDOWS_COMMAND_JOB, 'utf16le').toString('base64'),
    ],
    {
      env: {
        ...cleanCommandEnvironment(),
        ELECTRON_RUN_AS_NODE: '1',
        SKARO_COMMAND_NODE: process.execPath,
        SKARO_COMMAND_ENTRY: entry,
      },
      stdio: 'pipe',
      windowsHide: true,
    },
  );
}
