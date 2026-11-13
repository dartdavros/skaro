import type { ResourceCost } from '@skaro/core';
import type { CacheBudget } from './resource-cache-policy';

export const MANAGED_BUILDER_MEMORY = 512 * 1024 ** 2;
export type ManagedCacheBuildProfile = 'scratch' | 'trusted-run';
export function requireManagedCacheBuildSlot(slots: number, ownEnvelopeBuilds: number) {
  if (![slots, ownEnvelopeBuilds].every((value) => Number.isSafeInteger(value) && value >= 0))
    throw new Error('managed_cache_build_capacity_unknown');
  if (ownEnvelopeBuilds >= slots)
    throw new Error('managed_cache_worker_envelope_requires_available_build_slot');
}

/** Unknown installation expansion is reserved conservatively, never silently costed at zero. */
export function managedCacheCost(
  kind: 'dependencies' | 'buildkit',
  budget: CacheBudget,
  volume: string,
  targetVolume: string,
  sourceBytes = 512 * 1024 ** 2,
  profile: ManagedCacheBuildProfile = 'scratch',
): ResourceCost {
  if (
    !['scratch', 'trusted-run'].includes(profile) ||
    (kind === 'dependencies' && profile !== 'scratch') ||
    !volume ||
    !targetVolume ||
    !Number.isSafeInteger(sourceBytes) ||
    sourceBytes < 0 ||
    sourceBytes > Number.MAX_SAFE_INTEGER / 2 ||
    !Number.isSafeInteger(budget.bytes) ||
    budget.bytes < 0 ||
    budget.bytes > 8 * 1024 ** 3
  )
    throw new Error('managed_cache_cost_unknown');
  const diskBytes: Record<string, number> = {};
  diskBytes[volume] =
    kind === 'dependencies'
      ? budget.bytes * 2 + 2 * 1024 ** 3
      : Math.max(sourceBytes * 2, 128 * 1024 ** 2);
  if (kind === 'dependencies')
    diskBytes[targetVolume] = (diskBytes[targetVolume] ?? 0) + 2 * 1024 ** 3;
  return {
    ramBytes: (kind === 'dependencies' ? 3 : 1) * 1024 ** 3,
    cpuMillis: kind === 'dependencies' ? 1000 : 2000,
    model: 0,
    environment: kind === 'buildkit' ? 1 : 0,
    build: 1,
    review: 0,
    diskBytes,
    ...(kind === 'buildkit'
      ? {
          pools: {
            // Conservative daemon + one RUN estimate, not a measured descendant-cgroup proof.
            dockerRamBytes: MANAGED_BUILDER_MEMORY * (profile === 'trusted-run' ? 2 : 1),
            dockerCpuMillis: profile === 'trusted-run' ? 2000 : 1000,
            // Retained cache + image/base/active-build allowance; not a transient filesystem quota.
            dockerDiskBytes: budget.bytes + (profile === 'trusted-run' ? 6 : 2) * 1024 ** 3,
          },
        }
      : {}),
  };
}
