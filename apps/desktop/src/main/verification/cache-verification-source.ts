import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import type { AppDb, ResourceLeaseRequest, ResourceRecord } from '@skaro/core';
import type { ApplicationResources } from '../application-resources';
import { resourceExecution, resourcesFor } from '../resource-execution';
import { cacheVerificationProject } from './cache-verification-scope';

type Project = Awaited<ReturnType<typeof cacheVerificationProject>>;
export interface CacheVerificationSource extends Project {
  readonly resourceId: string;
  readonly generation: number;
  readonly locks: ResourceLeaseRequest['locks'];
}
const capabilities = new WeakSet<object>();
export function requireCacheVerificationSource(
  value: unknown,
): asserts value is CacheVerificationSource {
  if (!value || typeof value !== 'object' || !capabilities.has(value))
    throw new Error('cache_verification_host_source_capability_required');
}
function registeredSource(db: AppDb, resource: ResourceRecord) {
  const current = db.resources.get(resource.id);
  if (
    !current ||
    current.generation !== resource.generation ||
    current.state !== 'available' ||
    current.kind !== 'worktree' ||
    current.preservation !== 'persistent' ||
    current.ownership !== 'registered' ||
    current.owner.kind !== 'project' ||
    current.owner.id !== resource.projectId ||
    current.identity.path !== resource.identity.path ||
    db.resources.cleanup.read(resource.id)
  )
    throw new Error('cache_verification_source_generation_retained');
}
/** A real persistent main-worktree reader, not a fabricated disposable task/run or a worker API. */
export async function withCacheVerificationSource<T>(
  db: AppDb,
  resources: ApplicationResources,
  action: (source: CacheVerificationSource) => Promise<T>,
  options: { intentId: string; signal?: AbortSignal },
): Promise<T> {
  if (resourcesFor(db) !== resources)
    throw new Error('cache_verification_application_resources_required');
  const project = await cacheVerificationProject(db),
    info = await lstat(project.root);
  const dataVersion = createHash('sha256')
    .update(JSON.stringify([info.dev, info.ino, info.birthtimeMs]))
    .digest('hex');
  let record: ResourceRecord | undefined;
  return resources.scope(
    project.projectId,
    'cache-verification:source',
    async () => {
      record = db.resources.register({
        projectId: project.projectId,
        kind: 'worktree',
        identity: { path: project.root },
        owner: { kind: 'project', id: project.projectId },
        purpose: 'project-dev',
        ownership: 'registered',
        preservation: 'persistent',
        generation: 1,
        consumers: [],
        state: 'available',
        source: { recovery: 'skaro:registered-project-root-read-v1', dataVersion },
      });
      const source: CacheVerificationSource = Object.freeze({
        ...project,
        resourceId: record.id,
        generation: record.generation,
        locks: [{ resourceId: record.id, generation: record.generation, mode: 'shared' as const }],
        async requireCurrent() {
          await project.requireCurrent();
          registeredSource(db, record!);
        },
      });
      capabilities.add(source);
      const held = await resources.acquire('process', resourceExecution.getStore(), {
        wait: false,
        checkpoint: 'cache-verification-real-source',
        locks: source.locks,
        cost: {
          ramBytes: 128 * 1024 ** 2,
          cpuMillis: 500,
          model: 0,
          environment: 0,
          build: 0,
          review: 0,
          diskBytes: {},
        },
      });
      try {
        return await action(source);
      } finally {
        capabilities.delete(source);
        const unsettled = db.admission
          .all()
          .some(
            (lease) =>
              lease.id !== held.lease.id &&
              lease.projectId === project.projectId &&
              lease.intentId === options.intentId &&
              ['granted', 'retained'].includes(lease.state),
          );
        const current = db.admission.get(project.projectId, held.lease.id)!;
        if (unsettled && current.state === 'granted')
          db.admission.retain(project.projectId, current.id, current.revision);
        else if (!unsettled)
          held.release('real_source_preflight_and_delegated_cache_phases_settled');
      }
    },
    {
      ...options,
      requireCurrent: async () => {
        await project.requireCurrent();
        if (record) registeredSource(db, record);
      },
    },
  );
}
