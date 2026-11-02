import type { ModelResponseProvenance, RouteSnapshot } from '@skaro/timeline';
import type { JournalRecord } from '../model.ts';
import { sumReportedAmounts } from './reported-amount.ts';

export interface ModelUsageReceipt {
  effectId: string;
  route: RouteSnapshot;
  intent: { sequence: number; hash: string };
  receipt: { sequence: number; hash: string } | null;
  provenance: ModelResponseProvenance | null;
}

function receipt(
  value: Partial<ModelResponseProvenance>,
  route: RouteSnapshot,
): ModelResponseProvenance {
  const token = (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const text = (value: unknown) =>
    typeof value === 'string' && value.length <= 512 ? value : null;
  const usage = value.usage!;
  const cost = usage.cost;
  if (cost && (!/^[A-Z]{3}$/.test(cost.currency) || typeof cost.amount !== 'string'))
    throw new Error('Invalid reported cost receipt');
  return {
    route: structuredClone(route),
    actualModel: text(value.actualModel),
    upstream: text(value.upstream),
    requestId: text(value.requestId),
    usage: {
      inputTokens: token(usage.inputTokens),
      outputTokens: token(usage.outputTokens),
      cachedTokens: token(usage.cachedTokens),
      reasoningTokens: token(usage.reasoningTokens),
      cost: cost ? { amount: cost.amount, currency: cost.currency } : null,
    },
  };
}

/** Validated primary journal only: continuation echoes/command acknowledgements are not receipts. */
export function reportModelUsage(records: readonly JournalRecord[]) {
  let route: RouteSnapshot | undefined;
  const entries = new Map<string, ModelUsageReceipt>();
  for (const record of records)
    for (const fact of record.facts) {
      if (fact.type === 'created') route = fact.config.route;
      if (fact.type === 'route') route = fact.route;
      if (fact.type === 'effect-intent' && fact.name.startsWith('model:')) {
        if (!route || entries.has(fact.id)) throw new Error('Invalid model usage intent');
        entries.set(fact.id, {
          effectId: fact.id,
          route: structuredClone(route),
          intent: { sequence: record.sequence, hash: record.hash },
          receipt: null,
          provenance: null,
        });
      }
      if (fact.type !== 'effect-result') continue;
      const entry = entries.get(fact.id);
      if (!entry) continue;
      const value = fact.result as Partial<ModelResponseProvenance> | null;
      // A completed refusal is an effect result, but contains no service billing receipt.
      if (!value?.usage || !value.route) continue;
      if (
        entry.receipt ||
        record.id !== `${fact.id}:result` ||
        JSON.stringify(value.route) !== JSON.stringify(entry.route)
      )
        throw new Error('Model usage receipt identity differs from its intent');
      entry.receipt = { sequence: record.sequence, hash: record.hash };
      entry.provenance = receipt(value, entry.route);
    }
  const receipts = [...entries.values()];
  const costs = new Map<string, string[]>();
  let costsUnreported = 0;
  for (const entry of receipts) {
    const cost = entry.provenance?.usage.cost;
    if (!cost) {
      costsUnreported++;
      continue;
    }
    if (!/^[A-Z]{3}$/.test(cost.currency)) throw new Error('Invalid reported cost currency');
    const amounts = costs.get(cost.currency) ?? [];
    amounts.push(cost.amount);
    costs.set(cost.currency, amounts);
  }
  return {
    requests: receipts.length,
    responses: receipts.filter((entry) => entry.receipt !== null).length,
    costsUnreported,
    reportedCost: [...costs]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, amounts]) => ({ currency, amount: sumReportedAmounts(amounts) })),
    receipts,
  };
}
