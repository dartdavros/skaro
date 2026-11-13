import { join } from 'node:path';
import type { ManagedArtifact } from '../managed-cache-store';

/** Historical producer policy, not today's command profile/configuration or a cleanup capability. */
export const RECONCILIATION_UNIQUE_POLICY = 'pnpm-isolated-unique-nodes-v2';
export const RECONCILIATION_UNIQUE_METHOD = 'pnpm-isolated-unique-nodes-v2-complete';
export const RECONCILIATION_UNIQUE_PHASE =
  'all-public-downloads-complete-pre-fetch-shaped-sdk-closed';
export const uniqueReconciliationEntry = (entry: Pick<ManagedArtifact, 'expansionPolicy'>) =>
  entry.expansionPolicy === RECONCILIATION_UNIQUE_POLICY;

/** Static candidate classification only. Full immutable proof/tree/accounting validation follows. */
export function validReconciliationPublicationShape(
  entry: Readonly<ManagedArtifact>,
  version: number,
  storeRoot: string,
): boolean {
  if (!uniqueReconciliationEntry(entry))
    return entry.expansionPolicy === undefined && entry.installTarget === undefined;
  const target = entry.installTarget;
  return (
    version === 2 &&
    !!target &&
    Object.keys(target).sort().join(',') === 'birthtimeMs,dev,ino,path' &&
    target.path === join(storeRoot, 'scratch', `${entry.key}-publish`, 'node_modules') &&
    [target.dev, target.ino].every(
      (value) => Number.isInteger(value) && Number.isFinite(value) && value >= 0,
    ) &&
    Number.isFinite(target.birthtimeMs) &&
    target.birthtimeMs >= 0
  );
}
