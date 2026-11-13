import { C4ValidationError, type AppDb } from '@skaro/core';
import type { ProjectContext } from './projects';
import { c4ReviewKey } from './c4-fingerprint';
import { inspectC4TaskReview, type C4TaskReview } from './c4-review';
import { observeC4Impact, type C4ImpactObservation } from './c4-impact-observation';
import { memoryVersion } from './project-memory-sources';
import {
  C4ImpactReceipts,
  createC4ImpactReceipt,
  requireC4ObservationFresh,
  type C4LegacyReviewEvidence,
} from './c4-impact-receipt';

/** Legacy review_c4 is worker-authored. Its host preflight proves freshness/coverage, not semantics. */
async function inspectLegacyEvidence(
  db: AppDb,
  context: ProjectContext,
  observation: C4ImpactObservation,
): Promise<C4LegacyReviewEvidence> {
  const { taskId, runId, checkout } = observation.impact;
  const key = c4ReviewKey(context.id, taskId);
  const saved = db.getSetting<C4TaskReview | undefined>(key, undefined, { strict: true });
  if (!saved) return { state: 'absent', reason: 'independent_semantic_review_required' };
  if (
    saved.runId !== runId ||
    !saved.aligned ||
    !saved.evidence?.trim() ||
    observation.scope.kind !== 'implementation'
  )
    return { state: 'not-current', reason: 'legacy_review_not_current_implementation_evidence' };
  const reviewHash = memoryVersion(saved);
  try {
    // Inspection deliberately does not save artifact-only reviews or modify any legacy record.
    const inspected = await inspectC4TaskReview(db, context, taskId, checkout, runId);
    if (
      memoryVersion(inspected) !== reviewHash ||
      memoryVersion(db.getSetting(key, null, { strict: true })) !== reviewHash
    )
      return { state: 'not-current', reason: 'legacy_review_changed_during_inspection' };
    return {
      state: 'current',
      reviewHash,
      check: {
        id: 'host.legacy-review-preflight',
        fingerprint: memoryVersion({ reviewHash, impact: observation.impact }),
        outcome: 'passed',
      },
    };
  } catch (error) {
    if (!(error instanceof C4ValidationError)) throw error;
    return {
      state: 'not-current',
      reason: [...new Set(error.diagnostic.issues.map((issue) => issue.code))].sort().join(','),
    };
  }
}

/**
 * Opt-in host API only: no dispatch, protocol selection, model write, permission or completion.
 * These observation receipts stay unverified; independent semantics use their separate durable route.
 */
export async function recordC4ImpactObservation(
  db: AppDb,
  context: ProjectContext,
  taskId: string,
  runId: string,
) {
  const owner = { projectId: context.id, taskId, runId };
  const receipts = new C4ImpactReceipts(db.settings);
  const previous = receipts.current(owner)?.pointer;
  const observation = await observeC4Impact(db, context, taskId, runId);
  const legacyReview = await inspectLegacyEvidence(db, context, observation);
  const current = await observeC4Impact(db, context, taskId, runId);
  requireC4ObservationFresh(observation, current);
  // A review changed after its awaited preflight cannot be presented as current host evidence.
  if (legacyReview.state === 'current') {
    const saved = db.getSetting(c4ReviewKey(context.id, taskId), null, { strict: true });
    if (memoryVersion(saved) !== legacyReview.reviewHash)
      throw new Error('C4 legacy review changed before observation persistence');
  }
  const receipt = createC4ImpactReceipt(observation, legacyReview);
  const pointer = receipts.save(receipt, previous);
  return { pointer, receipt };
}

/** Read-only consumption must reobserve; a persisted receipt is history, not everlasting freshness. */
export async function inspectCurrentC4ImpactObservation(
  db: AppDb,
  context: ProjectContext,
  taskId: string,
  runId: string,
) {
  const owner = { projectId: context.id, taskId, runId };
  const receipts = new C4ImpactReceipts(db.settings);
  const saved = receipts.current(owner);
  if (!saved) return undefined;
  const current = await observeC4Impact(db, context, taskId, runId);
  requireC4ObservationFresh(saved.receipt.observation, current);
  const legacy = await inspectLegacyEvidence(db, context, current);
  if (memoryVersion(legacy) !== memoryVersion(saved.receipt.legacyReview))
    throw new Error('C4 legacy evidence changed after observation receipt');
  requireC4ObservationFresh(current, await observeC4Impact(db, context, taskId, runId));
  // The awaited inspection may overlap another writer. Never return an obsolete generation as current.
  if (memoryVersion(receipts.current(owner)?.pointer ?? null) !== memoryVersion(saved.pointer))
    throw new Error('C4 observation receipt generation changed during inspection');
  return saved;
}
