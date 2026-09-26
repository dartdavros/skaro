// "Открыть в редакторе" / "в терминале" with the apps chosen in "Настройки" → "Проекты".

import { spawn } from 'node:child_process';
import { shell } from 'electron';
import type { ExternalApp } from '../shared/ipc';

const EDITORS: Record<string, string> = { vscode: 'code', cursor: 'cursor', jetbrains: 'idea' };

function run(command: string, args: string[], cwd: string, useShell = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: 'ignore',
      shell: useShell,
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function systemTerminal(path: string): Promise<void> {
  if (process.platform === 'win32') return run('cmd.exe', ['/c', 'start', 'cmd.exe'], path);
  if (process.platform === 'darwin') return run('open', ['-a', 'Terminal', path], path);
  return run('x-terminal-emulator', [], path);
}

export async function openEditor(path: string, app: ExternalApp | null): Promise<void> {
  if (app?.kind === 'custom') return run(app.path, [path], path);
  const command = EDITORS[app?.kind ?? 'vscode'] ?? 'code';
  // Without the editor on PATH the folder opens in the system file manager.
  await run(command, ['.'], path, true).catch(async () => {
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  });
}

export async function openTerminal(path: string, app: ExternalApp | null): Promise<void> {
  switch (app?.kind) {
    case 'custom':
      return run(app.path, [], path);
    case 'iterm2':
      return run('open', ['-a', 'iTerm', path], path);
    case 'warp':
      return shell.openExternal(`warp://action/new_window?path=${encodeURIComponent(path)}`);
    default:
      return systemTerminal(path);
  }
}
