import { execFile } from 'node:child_process';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import type { DiagnosticMemory } from '../shared/diagnostics';

const execute = promisify(execFile);
const options = { timeout: 5000, maxBuffer: 4 * 1024 * 1024, windowsHide: true } as const;

interface ProcessRow {
  pid: number;
  bytes: number;
  name: string;
}

// Only these executable names can leave the machine; other children get a generic role.
function childRole(name: string): string {
  const exe = basename(name)
    .toLowerCase()
    .replace(/\.exe$/, '');
  return ['claude', 'codex', 'node', 'bun'].includes(exe) ? exe : 'other-child';
}

async function processTable() {
  const windows = process.platform === 'win32';
  // Do not request arguments, environment or executable paths from Windows.
  const query =
    'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize,Name | ForEach-Object { ' +
    '"{0} {1} {2} {3}" -f $_.ProcessId,$_.ParentProcessId,$_.WorkingSetSize,$_.Name }';
  const request = windows
    ? execute(
        join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', query],
        options,
      )
    : execute('/bin/ps', ['-A', '-o', 'pid=,ppid=,rss=,ucomm='], options);
  const { stdout } = await request;
  const children = new Map<number, ProcessRow[]>();
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    if (pid === request.child.pid) continue; // exclude the observer and its descendants
    const parent = Number(match[2]);
    const row = { pid, bytes: Number(match[3]) * (windows ? 1 : 1024), name: match[4]! };
    const siblings = children.get(parent);
    if (siblings) siblings.push(row);
    else children.set(parent, [row]);
  }
  return children;
}

/** On-demand snapshot taken before log replay. Never include PIDs, paths or command lines. */
export async function diagnosticMemory(): Promise<DiagnosticMemory> {
  const sampledAt = new Date().toISOString();
  let metrics: Electron.ProcessMetric[] = [];
  try {
    metrics = app.getAppMetrics();
  } catch {
    // The OS snapshot can still identify the main process and its descendants.
  }
  const electron = new Map(metrics.map((metric) => [metric.pid, metric]));
  const processes: DiagnosticMemory['processes'] = [];
  try {
    const children = await processTable();
    const root = children.get(process.ppid)?.find((row) => row.pid === process.pid);
    if (root) {
      const pending = [root];
      const seen = new Set<number>();
      for (const row of pending) {
        if (seen.has(row.pid)) continue;
        seen.add(row.pid);
        const role =
          row.pid === process.pid
            ? 'Browser'
            : (electron.get(row.pid)?.type ?? childRole(row.name));
        processes.push({ role, residentBytes: row.bytes });
        for (const child of children.get(row.pid) ?? []) pending.push(child);
      }
      return { sampledAt, scope: 'process-tree', processes };
    }
  } catch {
    // Sandboxing or an unavailable OS sampler must not prevent the diagnostic export.
  }
  for (const metric of metrics) {
    if (Number.isFinite(metric.memory?.workingSetSize))
      processes.push({ role: metric.type, residentBytes: metric.memory.workingSetSize * 1024 });
  }
  if (processes.length) return { sampledAt, scope: 'electron-only', processes };
  return {
    sampledAt,
    scope: 'main-only',
    processes: [{ role: 'Browser', residentBytes: process.memoryUsage.rss() }],
  };
}
