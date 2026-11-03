import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readRuntimeJournal, reportModelUsage } from '@skaro/agent-runtime';
import type { RouteSnapshot, RuntimeModelRequest } from '@skaro/timeline';
import { usdNanos } from './credentials/live-budget-ledger';

/** Product policy. Verification-only counters and the owner's $1 grant are never consulted here. */
export function productModelRequests(input: {
  journalPath: string;
  sessionId: string;
  route: RouteSnapshot;
  /** Absent means no spending cap. A supplied cap cannot use unknown price/holds as zero. */
  limitNanoUsd?: number;
  registerUsage?: () => void;
}) {
  const reservations = new Map<string, { hash: string; value: Record<string, unknown> }>();
  const limit = input.limitNanoUsd;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0))
    throw new Error('Invalid optional model spending limit');
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const current = async (id: string, request: RuntimeModelRequest, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (!isDeepStrictEqual(request.value.route, input.route))
      throw new Error('Product request differs from the selected route');
    const bytes = Buffer.byteLength(JSON.stringify(request));
    if (bytes > 1024 * 1024) throw new Error('Model request exceeds the product payload bound');
    const journal = await readRuntimeJournal(input.journalPath, input.sessionId);
    if (
      journal.state.effects[id]?.state !== 'pending' ||
      !journal.records.some((r) => r.id === `${id}:intent`)
    )
      throw new Error('Product request requires its actual pending intent');
    signal.throwIfAborted();
    input.registerUsage?.();
    return { bytes, journal };
  };
  const quote = (request: RuntimeModelRequest, bytes: number) => {
    if (limit === undefined) return null;
    if (request.kind !== 'chat' || input.route.connector !== 'openrouter')
      throw new Error('A USD cap requires enforceable provider price ceilings');
    const { price } = request.value;
    const output = Number(input.route.parameters.max_tokens ?? 1024);
    if (
      ![price.prompt, price.completion, price.request, output].every(
        (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
      )
    )
      throw new Error('A USD cap requires known complete request pricing');
    return Math.max(
      1,
      Math.ceil(
        ((bytes + 8192) * price.prompt + output * price.completion) * 1000 + price.request! * 1e9,
      ),
    );
  };
  const requireBudget = (
    records: Parameters<typeof reportModelUsage>[0],
    id: string,
    proposed: number | null,
  ) => {
    if (limit === undefined) return;
    let committed = 0;
    for (const receipt of reportModelUsage(records).receipts) {
      if (receipt.effectId === id) continue;
      const cost = receipt.provenance?.usage.cost;
      const held = records.find((r) => r.id === `budget:${receipt.effectId}`)?.result.value as
        { nanoUsd?: unknown } | undefined;
      const refusedBeforeAdmission =
        records.find((r) => r.id === `${receipt.effectId}:failed`)?.result.error ===
        'Model request not admitted';
      const amount =
        cost?.currency === 'USD'
          ? usdNanos(cost.amount)
          : (held?.nanoUsd ?? (refusedBeforeAdmission ? 0 : undefined));
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0)
        throw new Error('Unknown model billing cannot be released from the spending cap');
      committed += amount;
    }
    if (proposed === null || committed + proposed > limit)
      throw new Error('Optional model spending limit exhausted');
  };
  return {
    async reserve(id: string, request: RuntimeModelRequest, signal: AbortSignal) {
      const { bytes, journal } = await current(id, request, signal);
      const nanoUsd = quote(request, bytes);
      requireBudget(journal.records, id, nanoUsd);
      const value = {
        kind: 'product-model-admission',
        schema: 1,
        requestId: id,
        requestBytes: bytes,
        nanoUsd,
        limitNanoUsd: limit ?? null,
      };
      const fingerprint = hash(request);
      const old = reservations.get(id);
      if (old && old.hash !== fingerprint) throw new Error('Model intent request changed');
      reservations.set(id, { hash: fingerprint, value });
      return value;
    },
    async requireDispatch(id: string, request: RuntimeModelRequest, signal: AbortSignal) {
      const { journal } = await current(id, request, signal);
      const reservation = reservations.get(id);
      if (
        !reservation ||
        reservation.hash !== hash(request) ||
        !isDeepStrictEqual(
          journal.records.find((r) => r.id === `budget:${id}`)?.result.value,
          reservation.value,
        )
      )
        throw new Error('Product model dispatch requires the exact durable reservation');
      requireBudget(journal.records, id, reservation.value.nanoUsd as number | null);
    },
  };
}
