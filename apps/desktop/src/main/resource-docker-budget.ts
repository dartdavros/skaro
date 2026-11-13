import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { statfs } from 'node:fs/promises';
import { dockerStorageLocation } from './resource-docker-storage';
import type { ResourceBudget } from '@skaro/core';

const command = promisify(execFile);
const MiB = 1024 ** 2;
function memory(value: string): number {
  const match = /^([\d.]+)\s*(B|KiB|MiB|GiB|TiB|kB|MB|GB|TB)$/.exec(value.trim());
  if (!match) throw new Error('Unknown Docker memory unit');
  const unit = match[2]!;
  const index = ['B', 'kB', 'MB', 'GB', 'TB'].indexOf(unit.replace('i', '').replace('K', 'k'));
  const bytes = Math.ceil(Number(match[1]) * (unit.includes('i') ? 1024 : 1000) ** index);
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid Docker memory');
  return bytes;
}

/** Read-only daemon/VM observations. No probe containers or foreign cleanup are involved. */
export async function dockerResourceBudget(configuredStorage?: string): Promise<{
  pools: NonNullable<ResourceBudget['pools']>;
  storage?: string;
}> {
  const pools: NonNullable<ResourceBudget['pools']> = {
    dockerRamBytes: null,
    dockerCpuMillis: null,
    dockerDiskBytes: null,
  };
  let storage: string | undefined;
  try {
    const options = { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 };
    const info = JSON.parse(
      (await command('docker', ['info', '--format', '{{json .}}'], options)).stdout,
    );
    const stats = (
      await command('docker', ['stats', '--no-stream', '--format', '{{json .}}'], options)
    ).stdout;
    const used = stats
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .reduce((sum, line) => sum + memory(String(JSON.parse(line).MemUsage).split('/')[0]!), 0);
    if (Number.isSafeInteger(info.MemTotal) && info.MemTotal > 0)
      pools.dockerRamBytes = Math.max(
        0,
        info.MemTotal - used - Math.max(256 * MiB, Math.ceil(info.MemTotal / 10)),
      );
    if (Number.isSafeInteger(info.NCPU) && info.NCPU > 0)
      pools.dockerCpuMillis = Math.max(0, info.NCPU * 1000 - 500);
    const endpoint =
      process.env.DOCKER_HOST ??
      JSON.parse(
        (
          await command(
            'docker',
            ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'],
            options,
          )
        ).stdout,
      );
    const disk = await dockerStorageLocation(info, endpoint, configuredStorage);
    if (disk) {
      const fs = await statfs(disk, { bigint: true });
      const free = fs.bavail * fs.bsize;
      if (free <= BigInt(Number.MAX_SAFE_INTEGER)) {
        pools.dockerDiskBytes = Math.max(0, Number(free) - 1024 * MiB);
        storage = disk;
      }
    }
  } catch {
    /* Unknown VM metrics keep Docker admission closed, without blocking host-only work. */
  }
  return { pools, ...(storage ? { storage } : {}) };
}
