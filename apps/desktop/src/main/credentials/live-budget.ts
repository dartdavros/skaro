import type { ChatRequest, RuntimeSession } from '@skaro/agent-runtime';
import { dirname } from 'node:path';
import { liveBudgetLedger, type LiveBudgetReservation } from './live-budget-ledger';

/** Same conservative quotation for in-process and native acceptance. Never resets old holds. */
export function quoteLiveRequest(request: ChatRequest, id: string): LiveBudgetReservation {
  const bytes = Buffer.byteLength(JSON.stringify(request));
  const output = Number(request.route.parameters.max_tokens);
  if (
    bytes > 262_144 ||
    !Number.isSafeInteger(output) ||
    output < 1 ||
    output > 2048 ||
    !Number.isFinite(request.price.prompt) ||
    request.price.prompt < 0 ||
    request.price.prompt > 0.5 ||
    !Number.isFinite(request.price.completion) ||
    request.price.completion < 0 ||
    request.price.completion > 2 ||
    ((bytes > 16_384 || output > 512) && request.price.request !== 0)
  )
    throw new Error('Live request exceeds the authorized envelope');
  const nanoUsd = Math.ceil(
    (((bytes + 8192) * request.price.prompt) / 1_000_000 +
      (output * request.price.completion) / 1_000_000) *
      1_000_000_000,
  );
  return {
    kind: 'live-budget',
    schema: 1,
    requestId: id,
    nanoUsd: Math.max(1, nanoUsd),
    requestBytes: bytes,
  };
}
export async function requireLiveBudget(directory: string): Promise<void> {
  const ledger = await liveBudgetLedger(directory);
  if (ledger.requests > 80 || ledger.committedNanoUsd > 950_000_000)
    throw new Error('Total live acceptance budget exhausted');
}
/** Acceptance-only $1 total; unknown billing retains its reservation and $0.05 safety margin. */
export async function admitLiveRequest(
  session: RuntimeSession,
  request: ChatRequest,
  requestId?: string,
): Promise<void> {
  const pending = session.journal.records
    .findLast((record) =>
      record.facts.some((fact) => fact.type === 'effect-intent' && fact.name === 'model:chat'),
    )
    ?.facts.find((fact) => fact.type === 'effect-intent');
  const id = requestId ?? (pending?.type === 'effect-intent' ? pending.id : undefined);
  if (!id || session.journal.state.effects[id]?.state !== 'pending')
    throw new Error('Budget requires a durable pending model intent');
  const value = quoteLiveRequest(request, id);
  if (!session.journal.find(`budget:${id}`))
    await session.journal.append(`budget:${id}`, [], { value });
  await requireLiveBudget(dirname(session.journal.state.config!.journalPath));
}
