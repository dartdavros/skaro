import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { CoordinationOperation, RunRecord } from '@skaro/core';
import type { Item } from '@skaro/timeline';
import { coordinationHash } from './project-coordinator-request';

export interface SubmissionHistoryRequest {
  projectId: string;
  run: RunRecord;
  operation: CoordinationOperation;
  peers: CoordinationOperation[];
}

function explicitFailure(value: unknown): boolean {
  for (let depth = 0; depth < 4; depth++) {
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        return false;
      }
    }
    if (!value || typeof value !== 'object') return false;
    const result = value as { isError?: unknown; content?: { type?: string; text?: string }[] };
    if (result.isError === true) return true;
    if (
      result.content?.length !== 1 ||
      result.content[0]?.type !== 'text' ||
      typeof result.content[0].text !== 'string'
    )
      return false;
    value = result.content[0].text;
  }
  return false;
}

/** A returned native failure differs from transport loss, which has error/result=null. */
export function nativeSubmissionFailed(item: {
  status?: unknown;
  error?: unknown;
  result?: unknown;
}) {
  if (explicitFailure(item.result)) return true;
  const result = item.result as { content?: { type?: unknown; text?: unknown }[] } | null;
  return (
    item.status === 'failed' &&
    item.error === null &&
    !!result &&
    Array.isArray(result.content) &&
    result.content.some((entry) => entry?.type === 'text' && typeof entry.text === 'string')
  );
}

/** Exact arguments, native completion window and unique admitted dispatch bind an old receipt. */
function submissionHistoryBinding(request: SubmissionHistoryRequest, item: Item) {
  const { operation, run, projectId, peers } = request;
  if (
    operation.projectId !== projectId ||
    operation.state !== 'uncertain' ||
    operation.evidence?.code !== 'dispatch_result_unknown' ||
    run.projectId !== projectId ||
    operation.action !== 'mcp.submit_result' ||
    operation.subject.kind !== 'task' ||
    operation.subject.id !== run.taskId ||
    item.kind !== 'tool' ||
    item.server !== 'skaro' ||
    item.name !== 'submit_result' ||
    !['done', 'failed'].includes(item.status) ||
    !item.endedAt ||
    !item.input
  )
    return;
  let args: unknown;
  try {
    args = JSON.parse(item.input);
  } catch {
    return;
  }
  const scope = { kind: 'task', projectId, taskId: run.taskId, runId: run.id };
  if (coordinationHash({ args, scope }) !== operation.inputHash) return;
  const dispatched = peers.filter(
    (peer) =>
      peer.projectId === projectId &&
      peer.action === operation.action &&
      peer.inputHash === operation.inputHash &&
      peer.claimId &&
      peer.createdAt >= item.startedAt &&
      peer.updatedAt <= item.endedAt!,
  );
  if (dispatched.length !== 1 || dispatched[0]!.id !== operation.id) return;
  return { itemId: item.id, runId: run.id };
}

export function submissionHistoryFailure(request: SubmissionHistoryRequest, item: Item) {
  const proof = submissionHistoryBinding(request, item);
  if (!proof || item.kind !== 'tool' || !item.output || !explicitFailure(item.output)) return;
  return { ...proof, replyHash: createHash('sha256').update(item.output).digest('hex') };
}

export async function readSubmissionHistoryFailure(
  file: string,
  request: SubmissionHistoryRequest,
) {
  // Legacy native Codex receipts include exact start/completion timestamps. Do not retain
  // a complete projected timeline or send its large outputs over IPC to inspect one receipt.
  if (request.run.agent !== 'codex') return;
  const matches = new Map<string, NonNullable<ReturnType<typeof submissionHistoryFailure>>>();
  const starts = new Map<string, number>();
  const input = createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const text of lines) {
      if (!text.includes('mcpToolCall') || !text.includes('submit_result')) continue;
      let raw;
      try {
        raw = JSON.parse(text);
      } catch {
        continue;
      }
      const method = raw?.line?.method,
        params = raw?.line?.params,
        item = params?.item;
      if (
        raw?.dir !== 'out' ||
        item?.type !== 'mcpToolCall' ||
        item.server !== 'skaro' ||
        item.tool !== 'submit_result'
      )
        continue;
      if (method === 'item/started' && Number.isFinite(params.startedAtMs))
        starts.set(item.id, params.startedAtMs);
      if (
        method !== 'item/completed' ||
        !starts.has(item.id) ||
        !Number.isFinite(params.completedAtMs)
      )
        continue;
      const proof = submissionHistoryBinding(request, {
        id: item.id,
        kind: 'tool',
        name: item.tool,
        server: item.server,
        status: item.status === 'failed' ? 'failed' : 'done',
        input: JSON.stringify(item.arguments),
        startedAt: starts.get(item.id)!,
        endedAt: params.completedAtMs,
        turnId: params.turnId ?? '',
        native: { agent: 'codex', type: 'mcpToolCall', ref: item.id },
      });
      if (proof && nativeSubmissionFailed(item))
        matches.set(proof.itemId, {
          ...proof,
          replyHash: createHash('sha256').update(text).digest('hex'),
        });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  } finally {
    lines.close();
    input.destroy();
  }
  return matches.size === 1 ? [...matches.values()][0] : undefined;
}
