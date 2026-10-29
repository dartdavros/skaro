import { sameBundle, type BundleVersions } from './update-current';
import type { PendingUpdate } from './update-journal';
import { newer } from './update-release';

/**
 * An installer may finish even if its final journal write/quit callback was interrupted.
 * A downloaded bundle no newer than the running one was overtaken by another installation.
 */
export function recoveryDecision(
  pending: PendingUpdate,
  current: BundleVersions,
): 'confirm' | 'resume' | 'unverified' | 'superseded' {
  if (sameBundle(pending.manifest, current)) return 'confirm';
  if (pending.manifest.bundleVersion === current.bundleVersion) return 'unverified';
  if (!newer(pending.manifest.bundleVersion, current.bundleVersion)) return 'superseded';
  return 'resume';
}
