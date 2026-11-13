import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { AppDb } from '@skaro/core';
import type { ManagedBuildkitCache } from '../managed-buildkit-cache';
import { CACHE_BUILDKIT_OWNER_APPROVAL } from './cache-buildkit-approval';

export function cacheBuildkitHash(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, canonical(v)]),
      );
    return item;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

export function cacheBuildkitProjectState(db: AppDb) {
  const project = CACHE_BUILDKIT_OWNER_APPROVAL.projectId;
  return cacheBuildkitHash([
    db.shell.get(project),
    db.listRuns(project),
    [...db.getTaskRuntime(project)].sort(),
  ]);
}

/** Durable errors are bounded stable codes, never stacks, raw stderr, registry bodies or source text. */
function failureCode(error: unknown) {
  if (
    error instanceof Error &&
    /^(?:managed_|cache_buildkit_|cache_verification_)[a-z0-9_]{1,180}$/.test(error.message)
  )
    return { code: error.message };
  if (error instanceof Error && error.name === 'AssertionError')
    return { code: 'cache_buildkit_contract_assertion_failed' };
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === 'string' && /^(?:ENOENT|EACCES|EPERM|ENOSPC|EBUSY)$/.test(code))
    return { code: `cache_buildkit_filesystem_${code.toLowerCase()}` };
  return { code: 'cache_buildkit_verification_failed_details_not_persisted' };
}
export function cacheBuildkitFailure(error: unknown) {
  const causes: string[] = [],
    seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error && current.cause; depth++) {
    current = current.cause;
    if (seen.has(current)) break;
    seen.add(current);
    causes.push(failureCode(current).code);
  }
  return { ...failureCode(error), ...(causes.length ? { causes } : {}) };
}

export function requireCacheBuildkitReceipts(
  result: Awaited<ReturnType<ManagedBuildkitCache['build']>>,
  warm: boolean,
) {
  const owner = CACHE_BUILDKIT_OWNER_APPROVAL;
  assert.equal(result.state, 'verified-cached-solve');
  assert.equal(result.output, 'cacheonly-no-deploy-image');
  assert.equal(result.network, 'default');
  assert.equal(result.runSteps.length, 2, 'Both owner-approved RUNs must be observed');
  assert(result.runSteps.every((step, index) => step.instruction === index + 1 && step.observed));
  assert(result.runSteps.every((step) => /^sha256:[a-f0-9]{64}$/.test(step.vertex)));
  assert.equal(new Set(result.runSteps.map((step) => step.vertex)).size, 2);
  assert(result.runPlan && result.runPlan.runs.length === 2);
  assert.match(result.runPlan.digest, /^[a-f0-9]{64}$/);
  assert(result.runSteps.every((step) => step.cached === warm));
  assert.equal(result.sourceDigest, result.snapshotDigest);
  assert.match(result.snapshotDigest, /^[a-f0-9]{64}$/);
  // Export normalizes Windows mode bits; snapshotDigest need not equal the original sourceDigest.
  return {
    originalSourceDigest: owner.sourceDigest,
    recipeDigest: owner.recipeDigest,
    frozenExportDigest: result.snapshotDigest,
    runResourceGate: 'mandatory-actual-LLB-verified-by-solveManagedBuild-before-RUN',
    independentlyPersistedLlb: false,
    llbDigest: result.runPlan.digest,
    verifiedRunLimits: result.runPlan.runs,
    memoryBytes: 512 * 1024 ** 2,
    memorySwapBytes: 512 * 1024 ** 2,
    cpuQuota: 100000,
    cpuPeriod: 100000,
    requiredCapability: 'exec.meta.linux.resources',
  };
}

export function requireOnlyOwnedAdditions(
  before: Record<string, string>,
  after: Record<string, string>,
  allowedNew: readonly string[],
) {
  for (const [id, digest] of Object.entries(before))
    assert.equal(after[id], digest, 'An existing protected Docker object changed or disappeared');
  const added = Object.keys(after).filter((id) => !(id in before));
  assert(
    added.every((id) => allowedNew.includes(id)),
    'Unapproved new Docker object',
  );
  return added.sort();
}
