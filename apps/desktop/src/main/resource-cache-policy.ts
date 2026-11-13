import { createHash } from 'node:crypto';
import type { AppDb } from '@skaro/core';

export type CacheKind = 'history' | 'dependencies' | 'buildkit';
export interface CacheBudget {
  bytes: number;
  entries: number;
  idleMs: number;
}
export const CACHE_POLICY_KEY = 'resources.cache-policy.v1';
const defaults: Record<CacheKind, CacheBudget> = {
  history: { bytes: 128 * 1024 ** 2, entries: 256, idleMs: 7 * 86400000 },
  dependencies: { bytes: 1024 ** 3, entries: 32, idleMs: 14 * 86400000 },
  buildkit: { bytes: 2 * 1024 ** 3, entries: 1, idleMs: 7 * 86400000 },
};

export function cacheBudget(db: Pick<AppDb, 'getSetting'>, kind: CacheKind): CacheBudget {
  const configured = db.getSetting<Partial<Record<CacheKind, CacheBudget>>>(
    CACHE_POLICY_KEY,
    {},
    { strict: true },
  );
  const policy = { ...defaults[kind], ...configured[kind] };
  if (Object.values(policy).some((value) => !Number.isSafeInteger(value) || value < 0))
    throw new Error('Invalid managed cache budget');
  return policy;
}

/** Identity is project private; credentials, absolute source paths and mutable directories are not keys. */
export function immutableCacheKey(input: {
  projectId: string;
  kind: 'dependencies' | 'buildkit';
  lockDigest: string;
  toolVersion: string;
  platform: string;
  configurationDigest: string;
}): string {
  if (
    ![input.lockDigest, input.configurationDigest].every((value) => /^[a-f0-9]{64}$/.test(value)) ||
    !input.projectId ||
    !input.toolVersion ||
    !input.platform
  )
    throw new Error('Immutable cache provenance is incomplete');
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.projectId,
        input.kind,
        input.lockDigest,
        input.toolVersion,
        input.platform,
        input.configurationDigest,
      ]),
    )
    .digest('hex');
}

export interface CacheCandidate {
  id: string;
  bytes: number;
  usedAt: number;
  consumers: number;
  ownership: 'registered' | 'unknown';
  preservation: 'reproducible' | 'unique' | 'unknown';
  /** Verified by the trusted publisher, never inferred from filename or an agent's assertion. */
  immutable: boolean;
  secretsExcluded: boolean;
  privateScope: boolean;
}
export function cacheEviction(
  candidates: readonly CacheCandidate[],
  budget: CacheBudget,
  now: number,
  incoming = 0,
  incomingEntries = 0,
) {
  if (
    ![now, incoming, incomingEntries, ...Object.values(budget)].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    candidates.some(
      (entry) =>
        ![entry.bytes, entry.usedAt, entry.consumers].every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        ),
    )
  )
    throw new Error('Invalid managed cache accounting');
  let bytes = incoming + candidates.reduce((sum, entry) => sum + entry.bytes, 0),
    count = incomingEntries + candidates.length;
  if (
    !Number.isSafeInteger(bytes) ||
    !Number.isSafeInteger(count) ||
    candidates.some((entry) => typeof entry.id !== 'string' || !entry.id) ||
    new Set(candidates.map((entry) => entry.id)).size !== candidates.length
  )
    throw new Error('Invalid managed cache accounting');
  const remove: string[] = [],
    retained: { id: string; reason: string }[] = [];
  for (const entry of [...candidates].sort(
    (a, b) => a.usedAt - b.usedAt || a.id.localeCompare(b.id),
  )) {
    const reason = entry.consumers
      ? 'active-consumer'
      : entry.ownership !== 'registered' || !entry.privateScope
        ? 'ownership-unverified'
        : entry.preservation !== 'reproducible' || !entry.immutable || !entry.secretsExcluded
          ? 'reproducibility-unverified'
          : undefined;
    if (reason) {
      retained.push({ id: entry.id, reason });
      continue;
    }
    if (bytes <= budget.bytes && count <= budget.entries && now - entry.usedAt <= budget.idleMs)
      continue;
    remove.push(entry.id);
    bytes -= entry.bytes;
    count--;
  }
  return { remove, retained, fits: bytes <= budget.bytes && count <= budget.entries };
}
