import { isDeepStrictEqual } from 'node:util';
import { c4ImpactFingerprint, type AppDb } from '@skaro/core';
import { memoryVersion } from './project-memory-sources';
import type { C4ImpactObservation, C4ImpactOwner } from './c4-impact-observation';

export type C4LegacyReviewEvidence =
  | { state: 'absent' | 'not-current'; reason: string }
  | {
      state: 'current';
      reviewHash: string;
      check: { id: 'host.legacy-review-preflight'; fingerprint: string; outcome: 'passed' };
    };

/** Observation receipts are NOT C4 permissions, independent semantic reviews, or completion gates. */
export interface C4ImpactReceipt {
  version: 1;
  id: string;
  observation: C4ImpactObservation;
  legacyReview: C4LegacyReviewEvidence;
  semanticEvidence: 'unverified';
  nextStep: 'independent_semantic_review';
  modelWrite: 'none';
  mayApply: false;
  mayComplete: false;
}
export interface C4ImpactReceiptPointer {
  version: 1;
  generation: number;
  receiptId: string;
}

export function c4ObservationFingerprint(observation: C4ImpactObservation): string {
  if (
    observation.version !== 1 ||
    observation.inputs.projectId !== observation.impact.projectId ||
    observation.inputs.taskId !== observation.impact.taskId
  )
    throw new Error('C4 observation input ownership is inconsistent');
  return memoryVersion({
    impact: c4ImpactFingerprint(observation.impact),
    snapshot: observation,
  });
}

export function requireC4ObservationFresh(
  expected: C4ImpactObservation,
  current: C4ImpactObservation,
): void {
  if (c4ObservationFingerprint(expected) !== c4ObservationFingerprint(current))
    throw new Error('C4 observation is stale; collect current host evidence again');
}

export function createC4ImpactReceipt(
  observation: C4ImpactObservation,
  legacyReview: C4LegacyReviewEvidence,
): C4ImpactReceipt {
  // Also validates the metadata envelope. A current worker-authored legacy review grants no semantics.
  c4ObservationFingerprint(observation);
  const content = {
    version: 1 as const,
    observation,
    legacyReview,
    semanticEvidence: 'unverified' as const,
    nextStep: 'independent_semantic_review' as const,
    modelWrite: 'none' as const,
    mayApply: false as const,
    mayComplete: false as const,
  };
  return structuredClone({ ...content, id: memoryVersion(content) });
}

export function assertC4ImpactReceipt(receipt: C4ImpactReceipt, owner?: C4ImpactOwner): void {
  const { id, ...content } = receipt;
  const impact = receipt.observation.impact;
  c4ObservationFingerprint(receipt.observation);
  if (
    receipt.version !== 1 ||
    receipt.semanticEvidence !== 'unverified' ||
    receipt.nextStep !== 'independent_semantic_review' ||
    receipt.modelWrite !== 'none' ||
    receipt.mayApply !== false ||
    receipt.mayComplete !== false ||
    id !== memoryVersion(content) ||
    (owner &&
      (impact.projectId !== owner.projectId ||
        impact.taskId !== owner.taskId ||
        impact.runId !== owner.runId))
  )
    throw new Error('C4 observation receipt is damaged or belongs to another task run');
}

function assertPointer(pointer: C4ImpactReceiptPointer): void {
  if (
    pointer.version !== 1 ||
    !Number.isSafeInteger(pointer.generation) ||
    pointer.generation < 1 ||
    !/^[a-f0-9]{64}$/.test(pointer.receiptId)
  )
    throw new Error('C4 observation receipt pointer is damaged');
}

/** Pure CAS plan: exact replay is harmless; stale writers cannot replace newer observations. */
export function nextC4ImpactReceiptPointer(
  current: C4ImpactReceiptPointer | undefined,
  receiptId: string,
  expected?: C4ImpactReceiptPointer,
): C4ImpactReceiptPointer {
  if (!/^[a-f0-9]{64}$/.test(receiptId)) throw new Error('Invalid C4 observation receipt ID');
  if (current) assertPointer(current);
  if (expected) assertPointer(expected);
  if (current?.receiptId === receiptId) return structuredClone(current);
  if (!isDeepStrictEqual(current, expected))
    throw new Error('C4 observation receipt generation changed');
  const next = { version: 1 as const, generation: (current?.generation ?? 0) + 1, receiptId };
  assertPointer(next);
  return next;
}

const receiptKey = (id: string) => `c4.impact.observation.receipt.${id}`;
const pointerKey = (owner: C4ImpactOwner) =>
  `c4.impact.observation.current.${memoryVersion([owner.projectId, owner.taskId, owner.runId])}`;

/** Uses the existing atomic SQLite settings CAS, not an asynchronous get/set approximation. */
export class C4ImpactReceipts {
  private readonly settings: AppDb['settings'];
  constructor(settings: AppDb['settings']) {
    this.settings = settings;
  }

  current(owner: C4ImpactOwner) {
    const pointer = this.settings.getSetting<C4ImpactReceiptPointer | undefined>(
      pointerKey(owner),
      undefined,
      { strict: true },
    );
    if (!pointer) return undefined;
    assertPointer(pointer);
    const receipt = this.settings.getSetting<C4ImpactReceipt | undefined>(
      receiptKey(pointer.receiptId),
      undefined,
      { strict: true },
    );
    if (!receipt) throw new Error('C4 observation receipt referenced by pointer is missing');
    assertC4ImpactReceipt(receipt, owner);
    if (receipt.id !== pointer.receiptId) throw new Error('C4 observation receipt ID changed');
    return { pointer, receipt };
  }

  /** Caller must reobserve immediately before this synchronous persistence step and before use. */
  save(receipt: C4ImpactReceipt, expected?: C4ImpactReceiptPointer): C4ImpactReceiptPointer {
    assertC4ImpactReceipt(receipt);
    const { projectId, taskId, runId } = receipt.observation.impact;
    const owner = { projectId, taskId, runId };
    const key = receiptKey(receipt.id);
    if (!this.settings.compareAndSet(key, undefined, receipt)) {
      const previous = this.settings.getSetting<C4ImpactReceipt | undefined>(key, undefined, {
        strict: true,
      });
      if (!previous) throw new Error('C4 immutable observation receipt disappeared');
      assertC4ImpactReceipt(previous, owner);
      if (!isDeepStrictEqual(previous, receipt))
        throw new Error('C4 observation receipt is immutable');
    }
    const current = this.current(owner)?.pointer;
    const next = nextC4ImpactReceiptPointer(current, receipt.id, expected);
    if (isDeepStrictEqual(current, next)) return next;
    if (!this.settings.compareAndSet(pointerKey(owner), current, next)) {
      const winner = this.current(owner)?.pointer;
      if (winner?.receiptId === receipt.id) return winner;
      throw new Error('C4 observation receipt generation changed');
    }
    return next;
  }
}
