import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import { cacheDirectory, canonicalCachePath } from './managed-cache-files';
import { isolatedNpmEnvironment, managedCacheCommand } from './managed-cache-command';
import type { ManagedArtifact, ManagedCacheStore } from './managed-cache-store';
import { resourceExecution } from './resource-execution';
import { PNPM_VERSION } from './managed-pnpm-lock';
import { pnpmCommandFailure, pnpmCommandPhase } from './managed-pnpm-diagnostics';

export { pnpmCommandArguments } from './managed-pnpm-arguments';
export async function pnpmEnvironment(root: string, home: string) {
  await cacheDirectory(root, home);
  for (const name of ['user.npmrc', 'global.npmrc']) {
    const path = await canonicalCachePath(root, join(home, name), true);
    await writeFile(path, '', { flag: 'wx', mode: 0o600 });
  }
  return {
    ...isolatedNpmEnvironment(home),
    XDG_CONFIG_HOME: join(home, 'config'),
    XDG_DATA_HOME: join(home, 'data'),
    XDG_CACHE_HOME: join(home, 'cache'),
    PNPM_HOME: join(home, 'pnpm'),
    NODE_DISABLE_COMPILE_CACHE: '1',
  };
}
/** Journal exact child birth before effects; only an explicit close restores host ownership. */
export async function pnpmOwnedCommand(
  store: ManagedCacheStore,
  entry: ManagedArtifact,
  node: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
) {
  const scope = resourceExecution.getStore();
  if (!scope) throw new Error('managed_cache_resource_admission_required');
  let started = false,
    settled = false;
  let diagnosticTail = Buffer.alloc(0);
  try {
    return await managedCacheCommand(node, args, {
      cwd,
      env,
      stderr: (chunk) => {
        diagnosticTail = Buffer.concat([diagnosticTail, chunk]).subarray(-64 * 1024);
      },
      failed: (code, stdout) =>
        pnpmCommandFailure(pnpmCommandPhase(args), code, stdout, diagnosticTail.toString('utf8')),
      started: (pid, birth) => {
        started = true;
        entry.consumer = { intent: scope.intentId, pid, ...(birth ? { birth } : {}) };
        store.save(entry);
      },
      settled: () => {
        settled = true;
      },
    });
  } finally {
    if (!started || settled) {
      entry.consumer = {
        intent: scope.intentId,
        pid: process.pid,
        birth: await processBirth(process.pid),
      };
      store.save(entry);
    }
  }
}
export async function verifyPnpmRuntime(
  store: ManagedCacheStore,
  entry: ManagedArtifact,
  node: string,
  cli: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
) {
  const version = await pnpmOwnedCommand(store, entry, node, [cli, '--version'], cwd, env);
  if (version !== PNPM_VERSION) throw new Error('managed_pnpm_runtime_version_mismatch');
}
