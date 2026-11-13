import { app } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readdir, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { freemem, totalmem } from 'node:os';
import { git, type AppDb } from '@skaro/core';
import { recoveryProcessMeasurements } from './resource-recovery-processes';

const execute = promisify(execFile);
/** Logical directory bytes only. Never follows a junction or equates them to allocated/free bytes. */
async function logicalTree(root: string) {
  let files = 0,
    directories = 0,
    bytes = 0,
    links = 0;
  const pending = [root];
  try {
    while (pending.length) {
      if (files + directories + links > 100_000) throw new Error('measurement_entry_limit');
      const path = pending.pop()!,
        info = await lstat(path);
      if (info.isSymbolicLink()) links++;
      else if (info.isDirectory()) {
        directories++;
        pending.push(...(await readdir(path)).map((name) => join(path, name)));
      } else if (info.isFile()) {
        files++;
        bytes += info.size;
      }
    }
    return { files, directories, logicalBytes: bytes, linksSkipped: links, complete: links === 0 };
  } catch (error) {
    return {
      files,
      directories,
      logicalBytes: null,
      linksSkipped: links,
      complete: false,
      reason: (error as NodeJS.ErrnoException).code ?? 'bounded_measurement_failed',
    };
  }
}
async function dockerMeasurement(db: AppDb, project: string) {
  const owned = new Set(
    db.resources
      .list(project)
      .flatMap((r) => (r.identity.composeProject ? [r.identity.composeProject] : [])),
  );
  const run = async (args: string[]) =>
    (
      await execute('docker', args, {
        windowsHide: true,
        timeout: 60_000,
        maxBuffer: 4 * 1024 ** 2,
      })
    ).stdout.trim();
  try {
    const [ids, volumes, images, networks, usage, stats] = await Promise.all([
      run(['ps', '-aq', '--no-trunc']),
      run(['volume', 'ls', '-q']),
      run(['image', 'ls', '-q', '--no-trunc']),
      run(['network', 'ls', '-q', '--no-trunc']),
      run(['system', 'df', '--format', '{{json .}}']),
      run(['stats', '--no-stream', '--format', '{{json .}}']),
    ]);
    const containers = ids
      ? (JSON.parse(await run(['inspect', ...ids.split(/\r?\n/)])) as {
          Id: string;
          Config: { Labels?: Record<string, string> };
          State: { Running: boolean };
        }[])
      : [];
    const lines = (s: string) => s.split(/\r?\n/).filter(Boolean);
    return {
      available: true,
      containers: containers.map((c) => ({
        id: c.Id,
        running: c.State.Running,
        owned: owned.has(c.Config.Labels?.['com.docker.compose.project'] ?? ''),
      })),
      volumes: lines(volumes).sort(),
      images: [...new Set(lines(images))].sort(),
      networks: lines(networks).sort(),
      usage: lines(usage).map((l) => JSON.parse(l) as unknown),
      runningContainerStats: lines(stats).map((l) => JSON.parse(l) as unknown),
      hostVmAllocatedBytes: null,
      hostVmReason: 'Docker logical accounting does not measure host VM allocation',
    };
  } catch (error) {
    return {
      available: false,
      reason: (error as NodeJS.ErrnoException).code ?? 'docker_observation_failed',
      usage: null,
      runningContainerStats: null,
    };
  }
}
/** Actual measurements, with Skaro separated from host load and foreign Docker services. */
export async function resourceRecoveryMeasurements(db: AppDb, project: string, root: string) {
  const started = performance.now(),
    cpu = process.cpuUsage();
  const listed = (await git(root, ['worktree', 'list', '--porcelain', '-z'])).stdout
    .split('\0')
    .filter((s) => s.startsWith('worktree '))
    .map((s) => s.slice(9));
  const worktrees = [];
  for (const path of listed) worktrees.push({ path, ...(await logicalTree(path)) });
  const [docker, filesystem, processes] = await Promise.all([
    dockerMeasurement(db, project),
    statfs(root, { bigint: true }),
    recoveryProcessMeasurements(),
  ]);
  return {
    at: new Date().toISOString(),
    worktrees,
    count: worktrees.length,
    docker,
    host: {
      availableRamBytes: freemem(),
      totalRamBytes: totalmem(),
      availableDiskBytes: String(filesystem.bavail * filesystem.bsize),
      freeDiskBytes: String(filesystem.bfree * filesystem.bsize),
    },
    skaro: {
      ownedProcessTree: processes,
      mainPid: process.pid,
      memoryBytes: process.memoryUsage(),
      cpuMicroseconds: process.cpuUsage(cpu),
      electronProcesses: app.getAppMetrics(),
    },
    measurementMs: performance.now() - started,
    attribution:
      'Point observations; host deltas include background activity and are not attributed to cleanup',
  };
}
