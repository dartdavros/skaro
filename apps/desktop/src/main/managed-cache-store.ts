import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { AppDb, ResourceRecord } from '@skaro/core';
import { managedDockerClientFingerprint, type ManagedDockerClient } from './managed-docker-client';
import { cacheDirectory, canonicalCachePath } from './managed-cache-files';
import { artifactMetadata, builderMetadata, cacheProcessAbsent } from './managed-cache-metadata';
import type { PnpmTargetIdentity } from './managed-native-identity';

export interface ManagedArtifact {
  /** Absent in legacy npm metadata; never reinterpret an npm generation as pnpm. */
  manager?: 'npm' | 'pnpm';
  /** Host-produced accounting version; absent only in legacy generations. */
  expansionPolicy?: 'pnpm-isolated-unique-nodes-v2';
  installTarget?: PnpmTargetIdentity;
  key: string;
  projectId: string;
  resourceId: string;
  generation: number;
  state: 'publishing' | 'ready' | 'using' | 'deleting' | 'retained';
  bytes: number;
  usedAt: number;
  digest?: string;
  immutable?: boolean;
  expandedBytes: number;
  expandedFiles: number;
  consumer?: { intent: string; pid?: number; birth?: string };
}
export interface ManagedBuilder {
  projectId: string;
  name: string;
  token: string;
  resourceId: string;
  generation: number;
  state: 'creating' | 'ready' | 'using' | 'retained';
  client?: ManagedDockerClient;
  daemon?: string;
  container?: string;
  endpoint?: string;
  image: string;
  imageSource: string;
  imageBytes: number;
  bytes?: number;
  usedAt: number;
  policy: string;
  consumer?: { intent: string; pid?: number; birth?: string };
}
const ARTIFACTS = 'resources.managed-dependencies.v1';
const BUILDERS = 'resources.managed-builders.v1';
const queues = new Map<string, Promise<unknown>>();
export const DEPENDENCY_RECOVERY = 'skaro:npm-public-sha512-cacache-v1';
export const PNPM_DEPENDENCY_RECOVERY = 'skaro:pnpm-10.11-public-sha512-store-v10-v1';
export const dependencyRecovery = (entry: Pick<ManagedArtifact, 'manager'>) =>
  entry.manager === 'pnpm' ? PNPM_DEPENDENCY_RECOVERY : DEPENDENCY_RECOVERY;
export const BUILDKIT_RECOVERY = 'skaro:owned-isolated-remote-buildkit-v3';
export const builderDataVersion = (
  entry: Pick<ManagedBuilder, 'token' | 'image' | 'imageSource' | 'imageBytes' | 'client'>,
) => {
  const image = [entry.token, entry.image, entry.imageSource, entry.imageBytes];
  return JSON.stringify(
    entry.client
      ? [...image, { dockerClient: managedDockerClientFingerprint(entry.client) }]
      : image,
  );
};

/** Host-only durable metadata. Tool arguments cannot assert provenance or select an artifact path. */
export class ManagedCacheStore {
  readonly root: string;
  readonly db: AppDb;
  constructor(db: AppDb, dataDir: string) {
    this.db = db;
    this.root = resolve(dataDir, 'managed-caches-v1');
  }
  artifacts() {
    return artifactMetadata(this.db.getSetting<unknown>(ARTIFACTS, [], { strict: true }));
  }
  builders() {
    return builderMetadata(this.db.getSetting<unknown>(BUILDERS, [], { strict: true }));
  }
  save(value: ManagedArtifact) {
    this.db.setSetting(
      ARTIFACTS,
      artifactMetadata([...this.artifacts().filter((x) => x.key !== value.key), value]),
    );
  }
  saveBuilder(value: ManagedBuilder) {
    this.db.setSetting(
      BUILDERS,
      builderMetadata([...this.builders().filter((x) => x.projectId !== value.projectId), value]),
    );
  }
  forget(key: string) {
    this.db.setSetting(
      ARTIFACTS,
      this.artifacts().filter((x) => x.key !== key),
    );
  }
  scoped(projectId: string) {
    return !this.db.shell.projectScope || this.db.shell.projectScope === projectId;
  }
  path(key: string) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('managed_cache_invalid_key');
    return join(this.root, 'dependencies', key);
  }
  builderPath(projectId: string) {
    return join(this.root, 'buildkit', createHash('sha256').update(projectId).digest('hex'));
  }
  private verify(
    resource: ResourceRecord,
    projectId: string,
    path: string,
    recovery: string,
    dataVersion: string,
  ) {
    if (
      resource.projectId !== projectId ||
      resource.kind !== 'cache' ||
      resource.identity.path !== path ||
      resource.identity.composeProject ||
      resource.owner.kind !== 'project' ||
      resource.owner.id !== projectId ||
      resource.purpose !== 'cache' ||
      resource.ownership !== 'registered' ||
      resource.preservation !== 'reproducible' ||
      resource.source?.recovery !== recovery ||
      resource.source.dataVersion !== dataVersion
    )
      throw new Error('managed_cache_resource_binding_unverified');
    return resource;
  }
  resource(projectId: string, path: string, recovery: string, dataVersion: string): ResourceRecord {
    if (!this.scoped(projectId)) throw new Error('managed_cache_project_outside_scope');
    const old = this.db.resources
      .list(projectId)
      .find((x) => x.kind === 'cache' && x.identity.path === path);
    if (old) {
      this.verify(old, projectId, path, recovery, dataVersion);
      if (old.state === 'released') {
        if (old.consumers.length) throw new Error('managed_cache_released_resource_has_consumers');
        return this.db.resources.update(old.id, old.revision, {
          generation: old.generation + 1,
          state: 'available',
        });
      }
      return old;
    }
    return this.db.resources.register({
      projectId,
      kind: 'cache',
      identity: { path },
      owner: { kind: 'project', id: projectId },
      purpose: 'cache',
      ownership: 'registered',
      preservation: 'reproducible',
      generation: 1,
      consumers: [],
      state: 'available',
      source: { recovery, dataVersion },
    });
  }
  current(entry: ManagedArtifact | ManagedBuilder) {
    const resource = this.db.resources.get(entry.resourceId);
    if (!resource || resource.generation !== entry.generation)
      throw new Error('managed_cache_generation_changed');
    if (
      !('key' in entry) &&
      JSON.stringify(resource.objectIds ?? []) !==
        JSON.stringify(entry.container ? [entry.container] : [])
    )
      throw new Error('managed_cache_builder_objects_changed');
    return 'key' in entry
      ? this.verify(
          resource,
          entry.projectId,
          this.path(entry.key),
          dependencyRecovery(entry),
          entry.key,
        )
      : this.verify(
          resource,
          entry.projectId,
          this.builderPath(entry.projectId),
          BUILDKIT_RECOVERY,
          builderDataVersion(entry),
        );
  }
  outcome(
    entry: ManagedArtifact | ManagedBuilder,
    state: 'observed' | 'retained' | 'failed' | 'released',
    reason: string,
    freedBytes?: number,
  ) {
    const resource = this.current(entry),
      old = resource.lastOutcome;
    if (old?.generation === entry.generation && old.state === state && old.reason === reason)
      return;
    this.db.resources.recordOutcome({
      operationId: randomUUID(),
      resourceId: resource.id,
      generation: resource.generation,
      action: state === 'released' ? 'remove' : 'inspect',
      state,
      reason,
      ...(freedBytes === undefined ? {} : { freedBytes }),
    });
    const notice = `resources.cache-notice.${resource.id}.${entry.generation}.${state}.${reason}`;
    if (!this.db.getSetting(notice, false)) {
      this.db.setSetting(notice, true);
      this.db.addEvent(resource.projectId, 'resource_cache', {
        resourceId: resource.id,
        state,
        reason,
        generation: resource.generation,
        ...(freedBytes === undefined ? {} : { logicalBytesRemoved: freedBytes }),
      });
    }
    // Existing cleanup background producer surfaces retained outcomes; no invented UI key/state.
  }
  async serial<T>(action: () => Promise<T>): Promise<T> {
    const previous = queues.get(this.root) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await cacheDirectory(this.root, this.root);
        const lock = join(this.root, 'operation.lock');
        await canonicalCachePath(this.root, lock, true);
        try {
          await mkdir(lock);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          const file = await canonicalCachePath(this.root, join(lock, 'owner.json'));
          const info = await lstat(file);
          if (!info.isFile() || info.nlink !== 1 || info.size > 1024)
            throw new Error('managed_cache_lock_unverifiable', { cause: error });
          const owner = JSON.parse(await readFile(file, 'utf8')) as { pid: number; birth: string };
          if (
            !Number.isSafeInteger(owner.pid) ||
            owner.pid <= 0 ||
            typeof owner.birth !== 'string' ||
            !owner.birth ||
            !cacheProcessAbsent(owner.pid)
          )
            throw new Error('managed_cache_other_process_or_recycled_pid', { cause: error });
          await canonicalCachePath(this.root, file);
          await unlink(file);
          await canonicalCachePath(this.root, lock);
          await rmdir(lock);
          await mkdir(lock);
        }
        const birth = await processBirth(process.pid);
        if (!birth) throw new Error('managed_cache_process_identity_unavailable');
        await canonicalCachePath(this.root, join(lock, 'owner.json'), true);
        await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, birth }), {
          flag: 'wx',
          mode: 0o600,
        });
        try {
          return await action();
        } finally {
          await canonicalCachePath(this.root, join(lock, 'owner.json'));
          await unlink(join(lock, 'owner.json'));
          await canonicalCachePath(this.root, lock);
          await rmdir(lock);
        }
      });
    queues.set(this.root, next);
    try {
      return await next;
    } finally {
      if (queues.get(this.root) === next) queues.delete(this.root);
    }
  }
}
