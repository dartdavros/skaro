import { join } from 'node:path';
import { statfs } from 'node:fs/promises';
import { ManagedDependencyMaintenance } from './managed-dependency-maintenance';
import { cacheBudget } from './resource-cache-policy';
import { cacheTree, removeCacheTree } from './managed-cache-files';
import { type ManagedArtifact, PNPM_DEPENDENCY_RECOVERY } from './managed-cache-store';
import { downloadManagedTarball } from './managed-dependency-download';
import { NPM_INSTALL_BYTE_LIMIT, NPM_INSTALL_FILE_LIMIT } from './managed-npm-archive';
import { PnpmInstallLayout } from './managed-pnpm-install-layout';
import { PNPM_CONFIGURATION, pnpmMirrorLock, pnpmRecord } from './managed-pnpm-lock';
import { extractPnpmRuntime, PNPM_RUNTIME_TARBALL } from './managed-pnpm-runtime';
import {
  pnpmCommandArguments,
  pnpmEnvironment,
  pnpmOwnedCommand,
  verifyPnpmRuntime,
} from './managed-pnpm-command';
import { createPnpmTarget, removePnpmNodeModules } from './managed-pnpm-layout';
import {
  exclusivePnpmDirectory,
  pnpmHostConsumer,
  pnpmHostSettled,
  writePnpmInput,
} from './managed-pnpm-operation';
import type { PnpmProvenance } from './managed-pnpm-provenance';
import { resourceExecution } from './resource-execution';
import { verifyPnpmStoreRoundtrip } from './managed-pnpm-probe';
import { inspectPnpmRuntimeArchive } from './managed-pnpm-runtime-inspection';
import { pnpmRuntimeAccountedBytes } from './managed-pnpm-runtime-budget';
import {
  encodePnpmGraphFacts,
  writePnpmGraphFacts,
  type PnpmGraphFact,
} from './managed-pnpm-graph-facts';

/** Publishes complete store+verified packaged runtime, never mutable virtual-store aliases. */
export class ManagedPnpmPublisher extends ManagedDependencyMaintenance {
  protected async published(provenance: PnpmProvenance, projectId: string, node: string) {
    const { store } = this,
      budget = cacheBudget(store.db, 'dependencies');
    if (!budget.bytes || !budget.entries) throw new Error('managed_dependencies_cache_disabled');
    const allocation = await statfs(store.root);
    if (allocation.bsize < 1 || allocation.bsize > 65536)
      throw new Error('managed_dependencies_unsupported_allocation_unit');
    const expansion = new PnpmInstallLayout(
      provenance.lock,
      NPM_INSTALL_FILE_LIMIT,
      NPM_INSTALL_BYTE_LIMIT,
    );
    const initialExpansion = expansion.snapshot();
    await this.sweep(store.artifacts().some((item) => item.key === provenance.key) ? 0 : 1);
    const existing = store.artifacts().find((item) => item.key === provenance.key);
    if (existing) {
      if (
        existing.manager !== 'pnpm' ||
        existing.state !== 'ready' ||
        !existing.immutable ||
        !existing.digest
      )
        throw new Error('managed_dependencies_previous_operation_retained');
      store.current(existing);
      return existing;
    }
    const path = store.path(provenance.key),
      work = join(store.root, 'scratch', `${provenance.key}-publish`);
    const resource = store.resource(projectId, path, PNPM_DEPENDENCY_RECOVERY, provenance.key);
    if (resource.consumers.length) throw new Error('managed_dependencies_active_consumer');
    const entry: ManagedArtifact = {
      manager: 'pnpm',
      expansionPolicy: PNPM_CONFIGURATION.expansionPolicy,
      key: provenance.key,
      projectId,
      resourceId: resource.id,
      generation: resource.generation,
      state: 'publishing',
      bytes: 0,
      expandedBytes: initialExpansion.expandedBytes,
      expandedFiles: initialExpansion.nodes,
      usedAt: Date.now(),
      immutable: false,
      consumer: await pnpmHostConsumer(),
    };
    store.save(entry);
    this.consumer(entry, true);
    let publicationOwned = false;
    try {
      await exclusivePnpmDirectory(store.root, path);
      publicationOwned = true;
      await exclusivePnpmDirectory(store.root, work);
      const home = join(work, 'home'),
        env = await pnpmEnvironment(store.root, home);
      const runtimeArchive = join(path, 'pnpm.tgz'),
        runtime = join(path, 'runtime');
      const downloaded = await downloadManagedTarball(
        store,
        entry,
        PNPM_RUNTIME_TARBALL,
        budget.bytes,
        (entries, bytes) => this.sweep(entries, bytes),
        { path: runtimeArchive, runtime: true },
      );
      entry.bytes += downloaded.bytes;
      store.save(entry);
      const inspected = await inspectPnpmRuntimeArchive(store.root, runtimeArchive);
      await this.sweep(0, inspected.expandedBytes);
      // Persist a conservative precharge; a host-side partial extraction is recounted in catch.
      entry.bytes = pnpmRuntimeAccountedBytes(entry.bytes, inspected.expandedBytes, budget.bytes);
      store.save(entry);
      const runtimeBytes = await extractPnpmRuntime(store.root, runtimeArchive, runtime);
      if (runtimeBytes !== inspected.expandedBytes)
        throw new Error('managed_pnpm_runtime_expansion_changed');
      entry.bytes = (await cacheTree(store.root, path, budget.bytes)).bytes;
      store.save(entry);
      const cli = join(runtime, 'bin', 'pnpm.cjs');
      await verifyPnpmRuntime(store, entry, node, cli, home, env);
      const files = new Map<string, string>(),
        graphFacts = new Map<string, PnpmGraphFact>();
      for (const tarball of provenance.tarballs) {
        await resourceExecution.getStore()!.requireCurrent();
        const tarPath = join(path, 'tarballs', `${tarball.hex}.tgz`);
        const result = await downloadManagedTarball(
          store,
          entry,
          tarball,
          budget.bytes,
          (entries, bytes) => this.sweep(entries, bytes),
          { path: tarPath, inventory: 'pnpm-payload' },
        );
        entry.bytes += result.bytes;
        if (!result.archive) throw new Error('managed_dependencies_archive_inventory_missing');
        let matched = false;
        for (const [id, pkg] of Object.entries(pnpmRecord(provenance.lock.packages))) {
          if (pnpmRecord(pnpmRecord(pkg).resolution).integrity !== tarball.integrity) continue;
          graphFacts.set(id, {
            manifestDigest: result.archive.manifestDigest,
            bins: result.archive.binTargets,
          });
          const current = expansion.register(id, {
            nodes: result.archive.nodes,
            bytes: result.archive.bytes,
            bins: result.archive.bins,
          });
          entry.expandedBytes = current.expandedBytes;
          entry.expandedFiles = current.nodes;
          matched = true;
        }
        if (!matched) throw new Error('managed_dependencies_archive_not_in_original_lock');
        store.save(entry);
      }
      expansion.assertComplete();
      const graphBytes = encodePnpmGraphFacts(provenance.lock, graphFacts);
      await this.sweep(0, graphBytes.length);
      await writePnpmGraphFacts(store.root, path, graphBytes);
      entry.bytes += graphBytes.length;
      store.save(entry);
      for (const [id, pkg] of Object.entries(pnpmRecord(provenance.lock.packages))) {
        const integrity = pnpmRecord(pnpmRecord(pkg).resolution).integrity as string;
        files.set(
          id,
          join(
            path,
            'tarballs',
            `${Buffer.from(integrity.slice(7), 'base64').toString('hex')}.tgz`,
          ),
        );
      }
      await writePnpmInput(
        store.root,
        work,
        provenance.packageBytes,
        pnpmMirrorLock(provenance.lock, files),
      );
      // Reserve logical store content and conservative index/metadata overhead BEFORE pnpm expands it.
      await this.sweep(0, entry.expandedBytes + entry.expandedFiles * 4096 + 8 * 1024 ** 2);
      const target = await createPnpmTarget(work);
      entry.installTarget = target;
      store.save(entry);
      await pnpmOwnedCommand(
        store,
        entry,
        node,
        pnpmCommandArguments(cli, 'fetch', work, home, join(path, 'store'), target.path),
        work,
        env,
      );
      // Fetch may materialize a virtual layout. Detach all temporary aliases before sealing CAS.
      await removePnpmNodeModules(work, target.path, target);
      delete entry.installTarget;
      store.save(entry);
      await removeCacheTree(store.root, work);
      await removeCacheTree(store.root, runtimeArchive);
      await removeCacheTree(store.root, join(path, 'tarballs'));
      const tree = await cacheTree(store.root, path, budget.bytes);
      if (!tree.files.some((file) => file.path.startsWith('store/v10/index/')))
        throw new Error('managed_pnpm_store_index_missing');
      entry.bytes = tree.bytes;
      entry.digest = tree.digest;
      await verifyPnpmStoreRoundtrip(store, entry, provenance, node);
      entry.immutable = true;
      entry.state = 'ready';
      entry.consumer = undefined;
      entry.usedAt = Date.now();
      store.save(entry);
      this.consumer(entry, false);
      store.outcome(entry, 'observed', 'managed_pnpm_original_lock_verified_store_published');
      return entry;
    } catch (error) {
      entry.state = 'retained';
      // An unobservable child retains its exact consumer/lease, never a dead-PID guess.
      // Even settled incomplete work remains owned and fenced for explicit reconciliation.
      // Never race a still-running SDK. Host-side failures (including a partial archive/extraction)
      // retain the actual bounded private tree count; an unreadable tree keeps its conservative charge.
      if (publicationOwned && pnpmHostSettled(entry)) {
        try {
          entry.bytes = (await cacheTree(store.root, path)).bytes;
        } catch {
          /* Retain the prior charge. */
        }
      }
      store.save(entry);
      store.outcome(
        entry,
        'retained',
        pnpmHostSettled(entry)
          ? 'managed_pnpm_publication_incomplete'
          : 'managed_pnpm_publication_executor_unsettled',
      );
      throw error;
    }
  }
}
