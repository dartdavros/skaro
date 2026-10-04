import { sameBundle, type BundleVersions } from './update-current';
import type { PendingUpdate } from './update-journal';

/** An installer may finish even if its final journal write/quit callback was interrupted. */
export function recoveryDecision(
  pending: PendingUpdate,
  current: BundleVersions,
): 'confirm' | 'resume' | 'unverified' {
  if (sameBundle(pending.manifest, current)) return 'confirm';
  if (pending.manifest.bundleVersion === current.bundleVersion) return 'unverified';
  return 'resume';
}
