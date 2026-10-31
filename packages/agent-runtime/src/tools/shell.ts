export type CheckShell = 'system' | 'powershell';

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
