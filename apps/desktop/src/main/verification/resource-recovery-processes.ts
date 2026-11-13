import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** OS process ancestry, including service children absent from Electron's app metrics. No command lines. */
export async function recoveryProcessMeasurements() {
  if (process.platform !== 'win32')
    return { available: false, reason: 'Windows acceptance adapter only', processes: null };
  const script = `$items=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,KernelModeTime,UserModeTime,CreationDate);
$owned=[System.Collections.Generic.HashSet[uint32]]::new(); [void]$owned.Add(${process.pid});
do { $changed=$false; foreach($item in $items){if($owned.Contains($item.ParentProcessId) -and $owned.Add($item.ProcessId)){$changed=$true}} } while($changed);
ConvertTo-Json -InputObject @($items | Where-Object {$owned.Contains($_.ProcessId)}) -Depth 3 -Compress`;
  try {
    const { stdout } = await promisify(execFile)(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        windowsHide: true,
        timeout: 20_000,
        maxBuffer: 1024 ** 2,
      },
    );
    return {
      available: true,
      processes: JSON.parse(stdout) as unknown,
      units: 'WorkingSetSize: bytes; KernelModeTime/UserModeTime: Windows 100ns ticks',
      scope:
        'Main verification PID and observed descendants; includes the short-lived observation process',
    };
  } catch (error) {
    return {
      available: false,
      processes: null,
      reason: (error as NodeJS.ErrnoException).code ?? 'process_observation_failed',
    };
  }
}
