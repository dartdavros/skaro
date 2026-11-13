import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import { cacheDirectory, canonicalCachePath } from './managed-cache-files';
import { isolatedNpmEnvironment, managedCacheCommand, npmRuntime } from './managed-cache-command';
import { resourceExecution } from './resource-execution';
import type { ManagedArtifact } from './managed-cache-store';

export async function exclusivePnpmDirectory(root: string, path: string) {
  await canonicalCachePath(root, path, true);
  await cacheDirectory(root, dirname(path));
  await mkdir(path, { mode: 0o700 }); // EEXIST never adopts, clears or overwrites prior data.
  await canonicalCachePath(root, path);
  return path;
}
export async function writePnpmInput(
  root: string,
  work: string,
  manifest: Buffer,
  lock: Buffer | string,
) {
  for (const [name, bytes] of [
    ['package.json', manifest],
    ['pnpm-lock.yaml', lock],
    ['.npmrc', ''],
  ] as const) {
    const path = await canonicalCachePath(root, join(work, name), true);
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
  }
}
export async function pnpmHostConsumer() {
  const scope = resourceExecution.getStore(),
    birth = await processBirth(process.pid);
  if (!scope || !birth) throw new Error('managed_cache_process_identity_unavailable');
  return { intent: scope.intentId, pid: process.pid, birth };
}
export function pnpmHostSettled(entry: ManagedArtifact) {
  return entry.consumer?.pid === process.pid;
}
export async function pnpmNodeRuntime(root: string) {
  const runtime = await npmRuntime();
  const value = await managedCacheCommand(
    runtime.node,
    [
      '-p',
      'JSON.stringify([process.versions.node,process.versions.modules,process.platform,process.arch,!!process.versions.electron])',
    ],
    { cwd: root, env: isolatedNpmEnvironment(root) },
  );
  const info: unknown = JSON.parse(value);
  if (
    !Array.isArray(info) ||
    info.length !== 5 ||
    typeof info[0] !== 'string' ||
    Number(info[0].split('.')[0]) < 22 ||
    info[4] !== false ||
    info[2] !== process.platform ||
    info[3] !== process.arch
  )
    throw new Error('managed_pnpm_supported_node_runtime_unavailable');
  return { node: runtime.node, tool: `pnpm:10.11.0;node:${value}` };
}
export async function pnpmPresent(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
