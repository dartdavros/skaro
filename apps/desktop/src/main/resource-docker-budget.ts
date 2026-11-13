import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { statfs } from 'node:fs/promises';
import { dockerStorageLocation } from './resource-docker-storage';
import type { ResourceBudget } from '@skaro/core';
import { observeDockerResources, type DockerUsage } from './resource-docker-observation';

const command = promisify(execFile);
const MiB = 1024 ** 2;

/** Read-only daemon/VM observations. No probe containers or foreign cleanup are involved. */
export async function dockerResourceBudget(configuredStorage?: string): Promise<{
  pools: NonNullable<ResourceBudget['pools']>;
  storage?: string;
  usage: DockerUsage[];
  measuredAt: number;
}> {
  const pools: NonNullable<ResourceBudget['pools']> = {
    dockerRamBytes: null,
    dockerCpuMillis: null,
    dockerDiskBytes: null,
  };
  let storage: string | undefined;
  let usage: DockerUsage[] = [];
  let measuredAt = Date.now();
  try {
    const options = { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 };
    const snapshot = await observeDockerResources();
    const { info } = snapshot;
    usage = snapshot.usage;
    measuredAt = snapshot.measuredAt;
    const used = usage.reduce((sum, row) => sum + row.ramBytes, 0);
    if (Number.isSafeInteger(info.MemTotal) && info.MemTotal > 0)
      pools.dockerRamBytes = Math.max(
        0,
        info.MemTotal - used - Math.max(256 * MiB, Math.ceil(info.MemTotal / 10)),
      );
    if (Number.isSafeInteger(info.NCPU) && info.NCPU > 0)
      pools.dockerCpuMillis = Math.max(
        0,
        info.NCPU * 1000 - usage.reduce((sum, row) => sum + row.cpuMillis, 0) - 500,
      );
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
  return { pools, usage, measuredAt, ...(storage ? { storage } : {}) };
}
