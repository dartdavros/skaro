import { createHash, randomUUID } from 'node:crypto';
import type { ProcessAdmission } from '@skaro/timeline';

/** Transport identity only. Scope and permission still come from the authenticated host/grant. */
export interface ToolCallIdentity {
  id: string;
  transport: 'http' | 'internal';
  /** Non-secret grant or admitted session generation; never the bearer token or tool arguments. */
  sourceId: string;
}

/** Live transport authority; the guard must never be serialized into coordination metadata. */
export interface ToolCallContext extends ToolCallIdentity {
  requireActive(): void | Promise<void>;
}

const digest = (parts: readonly unknown[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex');

/** JSON-RPC string and numeric IDs are different identities within one trusted grant. */
export function httpToolCallIdentity(
  grantId: string,
  rpcId: string | number | null | undefined,
): ToolCallIdentity {
  if (!grantId) throw new Error('Missing tool grant identity');
  if (
    rpcId !== undefined &&
    rpcId !== null &&
    typeof rpcId !== 'string' &&
    (typeof rpcId !== 'number' || !Number.isFinite(rpcId))
  )
    throw new Error('Invalid JSON-RPC request identity');
  const request =
    rpcId === undefined || rpcId === null ? ['notification', randomUUID()] : [typeof rpcId, rpcId];
  return {
    id: `mcp:http:${digest([grantId, ...request])}`,
    transport: 'http',
    sourceId: grantId,
  };
}

/** Called only after requireActive accepts the admission; no scope is inferred from callId. */
export function internalToolCallIdentity(
  admission: Pick<ProcessAdmission, 'sessionId' | 'generation'>,
  callId: string,
): ToolCallIdentity {
  if (
    !admission.sessionId ||
    !Number.isSafeInteger(admission.generation) ||
    admission.generation < 1 ||
    !callId
  )
    throw new Error('Invalid internal tool call identity');
  return {
    id: `mcp:internal:${digest([admission.sessionId, admission.generation, callId])}`,
    transport: 'internal',
    sourceId: JSON.stringify([admission.sessionId, admission.generation]),
  };
}
