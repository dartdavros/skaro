import { join } from 'node:path';
import { cacheTree, cloneCacheTree, removeCacheTree, readCacheFile } from './managed-cache-files';
import { cacheBudget } from './resource-cache-policy';
import { ManagedPnpmPublisher } from './managed-pnpm-publisher';
import { pnpmDependencyProvenance } from './managed-pnpm-provenance';
import {
  pnpmCommandArguments,
  pnpmEnvironment,
  pnpmOwnedCommand,
  verifyPnpmRuntime,
} from './managed-pnpm-command';
import { createPnpmTarget, emptyPnpmTarget, pnpmNodeModules } from './managed-pnpm-layout';
import {
  exclusivePnpmDirectory,
  pnpmHostConsumer,
  pnpmHostSettled,
  pnpmNodeRuntime,
  writePnpmInput,
} from './managed-pnpm-operation';
import { resourceExecution } from './resource-execution';
import { readPnpmGraphFacts } from './managed-pnpm-graph-facts';

/** Private-target adapter. Task/host dispatchers authorize the source and target before admission. */
export class ManagedPnpmCache extends ManagedPnpmPublisher {
  async install(projectId: string, cwd: string, consume: boolean, sourceContext = '.') {
    const scope = resourceExecution.getStore(),
      { store } = this;
    if (!scope?.resources || scope.projectId !== projectId)
      throw new Error('managed_cache_resource_admission_required');
    await scope.requireCurrent();
    if (consume) await emptyPnpmTarget(cwd);
    const runtime = await pnpmNodeRuntime(store.root);
    const provenance = await pnpmDependencyProvenance(projectId, cwd, runtime.tool, sourceContext);
    const entry = await this.published(provenance, projectId, runtime.node);
    if (!consume)
      return { state: 'published', key: entry.key, bytes: entry.bytes, manager: 'pnpm' };
    if (!entry.immutable || !entry.digest)
      throw new Error('managed_dependencies_provenance_unverified');
    if (store.current(entry).consumers.length)
      throw new Error('managed_dependencies_active_consumer');
    const unchanged = async () => {
      if (
        (await pnpmDependencyProvenance(projectId, cwd, runtime.tool, sourceContext)).key !==
        entry.key
      )
        throw new Error('managed_dependencies_source_changed');
    };
    await unchanged();
    await emptyPnpmTarget(cwd);
    entry.state = 'using';
    entry.usedAt = Date.now();
    entry.consumer = await pnpmHostConsumer();
    store.save(entry);
    this.consumer(entry, true);
    const scratch = this.scratch(entry),
      work = join(scratch, 'work');
    try {
      // Every original file and the ENTIRE writable clone are hash checked, not pnpm's checkedAt heuristic.
      await cloneCacheTree(store.root, store.path(entry.key), scratch, entry.digest);
      const facts = await readPnpmGraphFacts(store.root, scratch, provenance.lock);
      await exclusivePnpmDirectory(store.root, work);
      const home = join(work, 'home'),
        env = await pnpmEnvironment(store.root, home);
      await writePnpmInput(store.root, work, provenance.packageBytes, provenance.lockBytes);
      const cli = join(scratch, 'runtime', 'bin', 'pnpm.cjs');
      await verifyPnpmRuntime(store, entry, runtime.node, cli, home, env);
      await scope.requireCurrent();
      await unchanged();
      // Final target is NEW and exclusive. A Windows junction/.modules.yaml layout is NEVER renamed.
      const target = await createPnpmTarget(cwd);
      entry.installTarget = target;
      store.save(entry);
      await pnpmOwnedCommand(
        store,
        entry,
        runtime.node,
        pnpmCommandArguments(cli, 'install', work, home, join(scratch, 'store'), target.path),
        work,
        env,
      );
      const installed = await pnpmNodeModules(cwd, target.path, target, {
        lock: provenance.lock,
        facts,
      });
      await scope.requireCurrent();
      await unchanged();
      if (
        !(await readCacheFile(store.root, join(work, 'package.json'), 16 * 1024 ** 2)).data.equals(
          provenance.packageBytes,
        ) ||
        !(
          await readCacheFile(store.root, join(work, 'pnpm-lock.yaml'), 16 * 1024 ** 2)
        ).data.equals(provenance.lockBytes)
      )
        throw new Error('managed_pnpm_original_input_changed');
      const original = await cacheTree(store.root, store.path(entry.key));
      if (original.digest !== entry.digest)
        throw new Error('managed_dependencies_integrity_changed');
      // Writable clone may legitimately update checkedAt/index metadata. Still verify its entire regular tree.
      await cacheTree(
        store.root,
        scratch,
        cacheBudget(store.db, 'dependencies').bytes + 32 * 1024 ** 2,
      );
      await removeCacheTree(store.root, scratch);
      entry.state = 'ready';
      delete entry.installTarget;
      entry.consumer = undefined;
      entry.usedAt = Date.now();
      store.save(entry);
      this.consumer(entry, false);
      store.outcome(
        entry,
        'observed',
        'managed_pnpm_original_lock_offline_install_completed_scripts_disabled',
      );
      return {
        state: 'installed',
        key: entry.key,
        bytes: entry.bytes,
        manager: 'pnpm',
        installedBytes: installed.bytes,
        installedNodes: installed.nodes.size,
        scripts: 'disabled',
        commandShims: 'private-target-only-not-executed',
        nodeModules: 'private-target-only',
        installedTarget: target,
      };
    } catch (error) {
      entry.state = 'retained';
      store.save(entry);
      // Failure retains the NEW partial target and scratch, never deletes prior data or guesses PID absence.
      store.outcome(
        entry,
        'retained',
        pnpmHostSettled(entry)
          ? 'managed_pnpm_install_partial_retained'
          : 'managed_pnpm_install_executor_unsettled',
      );
      throw error;
    }
  }
}
