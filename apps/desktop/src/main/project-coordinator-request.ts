import { createHash } from 'node:crypto';
import type {
  CoordinationRequest,
  CoordinationSource,
  CoordinationRef,
  CoordinationOperationInput,
} from '@skaro/core';

export interface ProjectOperationRequest {
  id: string;
  projectId: string;
  action: string;
  source: CoordinationSource;
  subject: CoordinationRef;
  inputHash: string;
  mode: CoordinationOperationInput['mode'];
  scopeKey: string;
  expectedVersion?: number;
  causationId?: string;
}

/** Canonical digest only: arguments and secret answers never enter the coordination journal. */
export function coordinationHash(value: unknown): string {
  const seen = new Set<object>();
  const canonical = (input: unknown, depth: number): unknown => {
    if (depth > 64) throw new Error('Coordination input is too deeply nested');
    if (input === undefined) return null;
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input !== 'object' || seen.has(input)) throw new Error('Invalid coordination input');
    if (!Array.isArray(input) && ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
      throw new Error('Coordination input must be plain data');
    seen.add(input);
    const result = Array.isArray(input)
      ? input.map((item) => canonical(item, depth + 1))
      : Object.fromEntries(
          Object.entries(input)
            .filter(([, item]) => item !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, item]) => [key, canonical(item, depth + 1)]),
        );
    seen.delete(input);
    return result;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(value, 0)))
    .digest('hex');
}

export function coordinationRequest(input: ProjectOperationRequest): CoordinationRequest {
  const { id, projectId, action, source, subject, inputHash, mode, scopeKey, expectedVersion } =
    input;
  const eventId = `event:${id}`;
  const intentId = `intent:${id}`;
  return {
    event: {
      id: eventId,
      projectId,
      kind: action,
      source,
      subject,
      inputHash,
      ...(input.causationId ? { causationId: input.causationId } : {}),
    },
    intent: { id: intentId, projectId, eventId, source, action, subject, inputHash },
    operation: {
      id,
      projectId,
      eventId,
      intentId,
      idempotencyKey: id,
      action,
      subject,
      inputHash,
      mode,
      scopeKey,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    },
  };
}
