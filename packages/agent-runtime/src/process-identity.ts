import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export interface ProcessIdentity {
  birth: string;
  platform: string;
}
export interface OwnedProcess extends ProcessIdentity {
  pid: number;
}
function command(pid: number): { file: string; args: string[] } {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid agent process id');
  return process.platform === 'win32'
    ? {
        file: 'powershell.exe',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `try { $start = [System.Diagnostics.Process]::GetProcessById(${pid}).StartTime; if ($null -ne $start) { $start.ToUniversalTime().Ticks }; exit 0 } catch [System.ArgumentException] { exit 0 } catch { Write-Error $_; exit 1 }`,
        ],
      }
    : { file: 'ps', args: ['-p', String(pid), '-o', 'lstart='] };
}
/** Synchronous ownership admission is allowed only in a native-session worker. */
export function processBirthSync(pid: number): string | undefined {
  const { file, args } = command(pid);
  try {
    return (
      execFileSync(file, args, { encoding: 'utf8', windowsHide: true, timeout: 10_000 }).trim() ||
      undefined
    );
  } catch (error) {
    if (process.platform !== 'win32' && (error as { status?: number }).status === 1)
      return undefined;
    throw error;
  }
}
export async function processBirth(pid: number): Promise<string | undefined> {
  const { file, args } = command(pid);
  try {
    return (
      (
        await execute(file, args, { encoding: 'utf8', windowsHide: true, timeout: 10_000 })
      ).stdout.trim() || undefined
    );
  } catch (error) {
    if (process.platform !== 'win32' && (error as { code?: number }).code === 1) return undefined;
    throw error;
  }
}
/** Verify creation identity before killing a tree; a recycled PID never proves ownership. */
export async function stopOwnedProcess(record: OwnedProcess): Promise<void> {
  if (record.platform !== process.platform)
    throw new Error('Agent process ownership belongs to another OS');
  if ((await processBirth(record.pid)) !== record.birth) return;
  try {
    if (process.platform === 'win32')
      await execute('taskkill.exe', ['/PID', String(record.pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 10_000,
      });
    else process.kill(-record.pid, 'SIGKILL');
  } catch (error) {
    if ((await processBirth(record.pid)) === record.birth) throw error;
  }
  for (let n = 0; (await processBirth(record.pid)) === record.birth; n++) {
    if (n === 20) throw new Error('The old agent process is still running. Handoff is blocked.');
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
}
