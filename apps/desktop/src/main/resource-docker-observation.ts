import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const command = promisify(execFile);
export interface DockerUsage {
  id: string;
  project?: string;
  service?: string;
  ramBytes: number;
  cpuMillis: number;
}
export function dockerMemory(value: string): number {
  const match = /^([\d.]+)\s*(B|KiB|MiB|GiB|TiB|kB|MB|GB|TB)$/.exec(value.trim());
  if (!match) throw new Error('Unknown Docker memory unit');
  const unit = match[2]!;
  const index = ['B', 'kB', 'MB', 'GB', 'TB'].indexOf(unit.replace('i', '').replace('K', 'k'));
  const bytes = Math.ceil(Number(match[1]) * (unit.includes('i') ? 1024 : 1000) ** index);
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid Docker memory');
  return bytes;
}
const records = (output: string): Record<string, string>[] =>
  output
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

/** Read existing containers only. Limits and Compose service counts are not consumption. */
export async function observeDockerResources() {
  const options = { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 };
  const [info, stats, containers] = await Promise.all([
    command('docker', ['info', '--format', '{{json .}}'], options),
    command('docker', ['stats', '--no-stream', '--no-trunc', '--format', '{{json .}}'], options),
    command('docker', ['ps', '--no-trunc', '--format', '{{json .}}'], options),
  ]);
  const identities = records(containers.stdout);
  const usage: DockerUsage[] = records(stats.stdout).map((row) => {
    const container = identities.find((item) => item.ID === row.ID);
    const labels = new Map(
      (container?.Labels ?? '').split(',').map((label) => {
        const at = label.indexOf('=');
        return [label.slice(0, at), label.slice(at + 1)];
      }),
    );
    const percent = Number(row.CPUPerc?.replace('%', ''));
    if (!Number.isFinite(percent) || percent < 0) throw new Error('Unknown Docker CPU usage');
    return {
      id: row.ID!,
      project: labels.get('com.docker.compose.project'),
      service: labels.get('com.docker.compose.service'),
      ramBytes: dockerMemory(String(row.MemUsage).split('/')[0]!),
      cpuMillis: Math.ceil(percent * 10),
    };
  });
  if (identities.some((row) => !usage.some((item) => item.id === row.ID)))
    throw new Error('Docker usage snapshot is incomplete');
  return { info: JSON.parse(info.stdout), usage, measuredAt: Date.now() };
}
