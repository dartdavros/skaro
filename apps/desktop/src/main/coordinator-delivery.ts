import { randomUUID } from 'node:crypto';
import type { AppDb, CoordinationEvidence, CoordinationOperation } from '@skaro/core';
import { CoordinationPending } from './project-coordinator-errors';
import { DecisionNotDispatched } from './decision-not-dispatched';
import { isSessionView } from './session-view-recovery';

export interface CoordinationExecution<T> {
  /** Main-owned classification for denial/stop only; never caller-provided authority. */
  whileSuspended?: boolean;
  /** Runtime authority only, rechecked after waiting. This callback must not perform the effect. */
  validate?: () => void | Promise<void>;
  evidence?: (value: T) => CoordinationEvidence;
  outcome?: (value: T) => 'succeeded' | 'failed' | 'uncertain';
  /** Authoritative read/projection only. Never the original external executor. */
  replay?: () => T | Promise<T>;
  /** Only domains with an exact persisted terminal failure receipt may opt in. */
  replayFailed?: boolean;
}

/** Durable dispatch boundary shared by the host and genuine SQLite verification. */
export async function dispatchProjectOperation<T>(
  ledger: AppDb['coordination'],
  accepted: CoordinationOperation,
  effect: () => T | Promise<T>,
  options: CoordinationExecution<T> = {},
): Promise<T> {
  const { projectId, id } = accepted;
  let current = ledger.getOperation(projectId, id)!;
  if (
    (current.state === 'succeeded' || (current.state === 'failed' && options.replayFailed)) &&
    options.replay
  ) {
    await options.validate?.();
    return options.replay();
  }
  if (current.state !== 'queued') throw new CoordinationPending(current);
  try {
    await options.validate?.();
  } catch (error) {
    current = ledger.getOperation(projectId, id)!;
    if (current.state === 'queued' && !(error instanceof CoordinationPending))
      ledger.reject(projectId, id, {
        expectedRevision: current.revision,
        evidence: { code: 'dispatch_preflight_rejected', refs: [current.subject] },
      });
    throw error;
  }
  current = ledger.getOperation(projectId, id)!;
  const claimId = randomUUID();
  const claimed = ledger.claim(projectId, id, { expectedRevision: current.revision, claimId });
  if (!claimed.acquired) throw new CoordinationPending(claimed.operation);
  const operation = claimed.operation;
  try {
    // No database transaction/lease spans a model turn or external handler.
    const value = await effect();
    ledger.finish(projectId, id, {
      expectedRevision: operation.revision,
      claimId,
      state: options.outcome?.(value) ?? 'succeeded',
      evidence: options.evidence?.(value) ?? {
        code: 'handler_returned',
        refs: [operation.subject],
      },
    });
    return value;
  } catch (error) {
    const latest = ledger.getOperation(projectId, id);
    if (latest?.state === 'dispatching' && latest.claimId === claimId)
      ledger.finish(projectId, id, {
        expectedRevision: latest.revision,
        claimId,
        state:
          error instanceof DecisionNotDispatched || isSessionView(operation)
            ? 'failed'
            : 'uncertain',
        evidence: {
          code:
            error instanceof DecisionNotDispatched
              ? 'decision_not_dispatched'
              : isSessionView(operation)
                ? 'session_view_not_returned'
                : 'dispatch_result_unknown',
          refs: [operation.subject],
        },
      });
    throw error;
  }
}
