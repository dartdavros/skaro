import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import type { ManagedArtifact } from '../managed-cache-store';
import { reconciliationHash } from './cache-verification-reconciliation-layout';
import type { ReconciliationTree } from './cache-verification-reconciliation-replay-types';

/** Stored exact known inputs/EMPTY target only; no install/link-aware tree is admitted here. */
export function assertUniqueReconciliationInputs(
  entry: Readonly<ManagedArtifact>,
  stage: ReconciliationTree,
  scratch: ReconciliationTree,
) {
  const fail = (reason: string): never => {
    throw new Error(`cache_reconciliation_unique_${reason}`);
  };
  if (
    !isDeepStrictEqual(stage.directories, ['']) ||
    !isDeepStrictEqual(
      stage.files.map((file) => file.path),
      ['package.json', 'pnpm-lock.yaml'],
    ) ||
    !isDeepStrictEqual(scratch.directories, ['', 'home', 'node_modules']) ||
    !isDeepStrictEqual(
      scratch.files.map((file) => file.path),
      ['.npmrc', 'home/global.npmrc', 'home/user.npmrc', 'package.json', 'pnpm-lock.yaml'],
    )
  )
    fail('input_shape');
  for (const name of ['.npmrc', 'home/global.npmrc', 'home/user.npmrc']) {
    const file = scratch.files.find((file) => file.path === name)!;
    if (file.bytes !== 0 || file.digest !== reconciliationHash('')) fail('configuration_changed');
  }
  const original = stage.files.find((file) => file.path === 'package.json'),
    copied = scratch.files.find((file) => file.path === 'package.json');
  if (!isDeepStrictEqual(original, copied)) fail('manifest_changed');
  const target = entry.installTarget,
    observed = scratch.identities.find((node) => node.path === 'node_modules');
  if (
    !target ||
    target.path !== join(scratch.path, 'node_modules') ||
    !observed?.directory ||
    observed.dev !== target.dev ||
    observed.ino !== target.ino ||
    observed.birthtimeMs !== target.birthtimeMs
  )
    fail('empty_target_identity_changed');
}
