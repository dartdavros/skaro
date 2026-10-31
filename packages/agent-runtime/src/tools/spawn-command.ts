import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { BuiltinToolScope } from '@skaro/timeline';
import { cleanCommandEnvironment } from './command-env.ts';
import { WINDOWS_COMMAND_JOB } from './windows-job.ts';

export function spawnCommandSupervisor(config: BuiltinToolScope) {
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
        SKARO_COMMAND_ENTRY:
          config.commandEntry ?? fileURLToPath(new URL('./command-worker.ts', import.meta.url)),
      },
      stdio: 'pipe',
      windowsHide: true,
    },
  );
}
