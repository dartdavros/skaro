export type CheckShell = 'system' | 'powershell';

/** Exact shell selection; never silently run a Bash script through another shell. */
export function commandInvocation(command: string, shell: string) {
  if (process.platform === 'win32') {
    if (shell === 'powershell') return checkCommand(command, 'powershell');
    if (shell === 'cmd') return checkCommand(command, 'system');
  } else if (['linux', 'darwin'].includes(process.platform)) {
    if (shell === 'sh' || shell === 'bash')
      return {
        command: shell === 'sh' ? '/bin/sh' : '/bin/bash',
        args: ['-c', command],
        shell: false,
      };
  }
  throw new Error('Selected shell is unavailable on this OS');
}

/** Pass scripts as data so the platform shell cannot reinterpret PowerShell syntax. */
export function checkCommand(command: string, shell: CheckShell = 'system') {
  if (shell === 'system') return { command, args: [], shell: true };
  if (shell !== 'powershell') throw new Error(`Unsupported check shell: ${shell}`);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$OutputEncoding = [Console]::OutputEncoding',
    '$global:LASTEXITCODE = 0',
    command,
    'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
  ].join('\n');
  return {
    command: process.platform === 'win32' ? 'powershell.exe' : 'pwsh',
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-OutputFormat',
      'Text',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    shell: false,
  };
}
