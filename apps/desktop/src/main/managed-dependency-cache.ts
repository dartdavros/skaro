import { lstat, mkdir, rename, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import { cacheBudget } from './resource-cache-policy';
import {
  cacheDirectory,
  cacheTree,
  canonicalCachePath,
  cloneCacheTree,
  removeCacheTree,
} from './managed-cache-files';
import { isolatedNpmEnvironment, managedCacheCommand, npmRuntime } from './managed-cache-command';
import { dependencyProvenance, UnsupportedDependencyCache } from './managed-dependency-provenance';
import { DEPENDENCY_RECOVERY as RECOVERY } from './managed-cache-store';
import { resourceExecution } from './resource-execution';
import { cacheProcessAbsent } from './managed-cache-metadata';
import {
  NPM_INSTALL_BYTE_LIMIT,
  NPM_INSTALL_FILE_LIMIT,
  npmExpansionFits,
} from './managed-npm-archive';
import { ManagedDependencyMaintenance } from './managed-dependency-maintenance';
import { downloadManagedTarball } from './managed-dependency-download';

export class ManagedDependencyCache extends ManagedDependencyMaintenance {
  async install(projectId: string, cwd: string, consume: boolean, sourceContext = '.') {
    const { store } = this,
      scope = resourceExecution.getStore();
    if (!scope?.resources || scope.projectId !== projectId)
      throw new Error('managed_cache_resource_admission_required');
    await scope.requireCurrent();
    if (consume) await this.emptyInstallTarget(cwd);
    const runtime = await npmRuntime();
    const home = await cacheDirectory(store.root, join(store.root, 'npm-home'));
    const allocation = await statfs(home);
    if (allocation.bsize > 65536 || allocation.bsize < 1)
      throw new UnsupportedDependencyCache('managed_dependencies_unsupported_allocation_unit');
    const env = isolatedNpmEnvironment(home);
    const version = await managedCacheCommand(runtime.node, [runtime.cli, '--version'], {
      cwd: home,
      env,
    });
    const nodeVersion = await managedCacheCommand(
      runtime.node,
      [
        '-p',
        'JSON.stringify([process.version,process.versions.modules,process.platform,process.arch])',
      ],
      { cwd: home, env },
    );
    if (!/^\d+\.\d+\.\d+$/.test(version))
      throw new Error('managed_dependencies_npm_version_invalid');
    const tool = `npm:${version};node:${nodeVersion}`;
    const provenance = await dependencyProvenance(projectId, cwd, tool, sourceContext);
    const budget = cacheBudget(store.db, 'dependencies');
    npmExpansionFits(
      0,
      provenance.tarballs.reduce((sum, x) => sum + x.installNodes, 0),
      1,
    );
    if (!budget.bytes || !budget.entries) throw new Error('managed_dependencies_cache_disabled');
    await this.sweep(store.artifacts().some((x) => x.key === provenance.key) ? 0 : 1);
    let entry = store.artifacts().find((x) => x.key === provenance.key);
    if (entry && entry.state !== 'ready')
      throw new Error('managed_dependencies_previous_operation_retained');
    if (!entry) {
      const path = await canonicalCachePath(store.root, store.path(provenance.key), true);
      const resource = store.resource(projectId, path, RECOVERY, provenance.key);
      if (resource.consumers.length) throw new Error('managed_dependencies_active_consumer');
      entry = {
        key: provenance.key,
        projectId,
        resourceId: resource.id,
        generation: resource.generation,
        state: 'publishing',
        bytes: 0,
        expandedBytes: 0,
        expandedFiles: 0,
        usedAt: Date.now(),
        immutable: false,
        consumer: {
          intent: scope.intentId,
          pid: process.pid,
          birth: await processBirth(process.pid),
        },
      };
      store.save(entry);
      this.consumer(entry, true);
      try {
        await cacheDirectory(store.root, path);
        for (const tarball of provenance.tarballs) {
          await scope.requireCurrent();
          const downloaded = await downloadManagedTarball(
            store,
            entry,
            tarball,
            budget.bytes,
            (entries, bytes) => this.sweep(entries, bytes),
          );
          entry.bytes += downloaded.bytes;
          Object.assign(
            entry,
            npmExpansionFits(
              downloaded.expandedBytes,
              downloaded.expandedFiles,
              1,
              entry.expandedBytes,
              entry.expandedFiles,
            ),
          );
          store.save(entry);
        }
        const tree = await cacheTree(store.root, path, budget.bytes);
        entry = {
          ...entry,
          bytes: tree.bytes,
          digest: tree.digest,
          state: 'ready',
          immutable: true,
          consumer: undefined,
        };
        store.save(entry);
        this.consumer(entry, false);
        store.outcome(entry, 'observed', 'managed_dependencies_immutable_published');
      } catch (error) {
        entry.state = 'retained';
        entry.consumer = undefined;
        store.save(entry);
        this.consumer(entry, false);
        store.outcome(entry, 'retained', 'managed_dependencies_publication_incomplete');
        await this.discardIncomplete(entry).catch(() => undefined);
        throw error;
      }
    }
    if (!consume) return { state: 'published', key: entry.key, bytes: entry.bytes };
    if (!entry.immutable || !entry.digest)
      throw new Error('managed_dependencies_provenance_unverified');
    if ((await dependencyProvenance(projectId, cwd, tool, sourceContext)).key !== entry.key)
      throw new Error('managed_dependencies_source_changed');
    await this.emptyInstallTarget(cwd);
    const scratch = this.scratch(entry),
      stage = join(cwd, `.skaro-managed-npm-${entry.key}-${entry.generation}`);
    entry = {
      ...entry,
      state: 'using',
      usedAt: Date.now(),
      consumer: {
        intent: scope.intentId,
        pid: process.pid,
        birth: await processBirth(process.pid),
      },
    };
    store.save(entry);
    this.consumer(entry, true);
    let settled = false,
      scratchOwned = false,
      stageOwned = false;
    try {
      await cloneCacheTree(store.root, store.path(entry.key), scratch, entry.digest!, () => {
        scratchOwned = true;
      });
      await canonicalCachePath(cwd, stage, true);
      await mkdir(stage, { mode: 0o700 });
      stageOwned = true;
      await writeFile(join(stage, 'package.json'), provenance.packageBytes, {
        flag: 'wx',
        mode: 0o600,
      });
      await writeFile(join(stage, 'package-lock.json'), provenance.lockBytes, {
        flag: 'wx',
        mode: 0o600,
      });
      const userconfig = join(home, 'user.npmrc'),
        globalconfig = join(home, 'global.npmrc');
      for (const file of [userconfig, globalconfig]) {
        await canonicalCachePath(store.root, file, true);
        await writeFile(file, '', { mode: 0o600 });
      }
      await scope.requireCurrent();
      if ((await dependencyProvenance(projectId, cwd, tool, sourceContext)).key !== entry.key)
        throw new Error('managed_dependencies_source_changed');
      await this.emptyInstallTarget(cwd);
      await managedCacheCommand(
        runtime.node,
        [
          '--max-old-space-size=256',
          '--max-semi-space-size=16',
          runtime.cli,
          'ci',
          '--offline',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--install-links=false',
          '--bin-links=false',
          '--include=dev',
          '--include=optional',
          '--include=peer',
          '--registry=https://registry.npmjs.org/',
          `--cache=${scratch}`,
          `--userconfig=${userconfig}`,
          `--globalconfig=${globalconfig}`,
          '--logs-max=0',
          '--update-notifier=false',
        ],
        {
          cwd: stage,
          env,
          started: (pid, birth) => {
            entry!.consumer = { intent: scope.intentId, pid, ...(birth ? { birth } : {}) };
            store.save(entry!);
          },
        },
      );
      settled = true;
      const installed = await cacheTree(
        cwd,
        join(stage, 'node_modules'),
        NPM_INSTALL_BYTE_LIMIT + 32 * 1024 ** 2,
      );
      if (installed.nodes.size > NPM_INSTALL_FILE_LIMIT + 8)
        throw new Error('managed_dependencies_install_expansion_changed');
      await scope.requireCurrent();
      if ((await dependencyProvenance(projectId, cwd, tool, sourceContext)).key !== entry.key)
        throw new Error('managed_dependencies_source_changed');
      await this.emptyInstallTarget(cwd);
      await rename(join(stage, 'node_modules'), join(cwd, 'node_modules'));
      store.outcome(
        entry,
        'observed',
        'managed_dependencies_offline_install_completed_scripts_disabled',
      );
      return {
        state: 'installed',
        key: entry.key,
        bytes: entry.bytes,
        scripts: 'disabled',
        commandShims: 'disabled',
        nodeModules: 'task-local-only',
      };
    } catch (error) {
      // Commands settle after exit; a recycled or unobservable PID is retained, not guessed dead.
      const pid = entry.consumer?.pid;
      settled = pid === process.pid || (!!pid && cacheProcessAbsent(pid));
      store.outcome(entry, 'retained', 'managed_dependencies_install_failed');
      throw error;
    } finally {
      if (settled) {
        if (stageOwned) await removeCacheTree(cwd, stage);
        if (scratchOwned) await this.removeIfPresent(scratch);
        entry = { ...entry, state: 'ready', consumer: undefined, usedAt: Date.now() };
        store.save(entry);
        this.consumer(entry, false);
      } else {
        entry.state = 'retained';
        store.save(entry);
      }
    }
  }

  private async emptyInstallTarget(cwd: string) {
    if (cwd.length > 1024)
      throw new UnsupportedDependencyCache('managed_dependencies_unsupported_install_path');
    const nodeModules = await canonicalCachePath(cwd, join(cwd, 'node_modules'), true);
    try {
      await lstat(nodeModules);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const fs = await statfs(cwd);
      if (fs.bsize > 65536 || fs.bsize < 1)
        throw new UnsupportedDependencyCache('managed_dependencies_unsupported_allocation_unit');
      return;
    }
    throw new UnsupportedDependencyCache('managed_dependencies_existing_node_modules_retained');
  }
}
