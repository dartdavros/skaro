import { join } from 'node:path';
import {
  parseModelUsageSources,
  readRuntimeJournal,
  reportModelUsage,
  sumReportedAmounts,
} from '@skaro/agent-runtime';
import type { ModelUsageSummary } from '../../shared/model-usage';
import { builtinSessionDirectory } from '../builtin-session-directory';

/** Verify/parse potentially large primary journals away from the main/UI thread. */
export async function aggregateModelUsage(
  dataDir: string,
  raw: unknown,
): Promise<ModelUsageSummary> {
  const sessions = parseModelUsageSources(raw);
  const result: ModelUsageSummary = {
    checkedAt: new Date().toISOString(),
    requests: 0,
    responses: 0,
    costsUnreported: 0,
    reportedCost: [],
    knownInputTokens: 0,
    knownOutputTokens: 0,
    tokensUnreported: 0,
    unavailableSessions: 0,
  };
  const costs = new Map<string, string[]>(),
    visited = new Set<string>();
  for (const session of sessions) {
    const path = join(
      builtinSessionDirectory(dataDir, session.kind, session.id, session.sessionId),
      'journal.jsonl',
    );
    if (visited.has(path)) continue;
    visited.add(path);
    try {
      const journal = await readRuntimeJournal(path, session.sessionId);
      const usage = reportModelUsage(journal.records);
      result.requests += usage.requests;
      result.responses += usage.responses;
      result.costsUnreported += usage.costsUnreported;
      for (const cost of usage.reportedCost)
        costs.set(cost.currency, [...(costs.get(cost.currency) ?? []), cost.amount]);
      for (const receipt of usage.receipts) {
        const tokens = receipt.provenance?.usage;
        result.knownInputTokens += tokens?.inputTokens ?? 0;
        result.knownOutputTokens += tokens?.outputTokens ?? 0;
        if (tokens?.inputTokens == null || tokens.outputTokens == null) result.tokensUnreported++;
      }
    } catch {
      result.unavailableSessions++;
    }
  }
  result.reportedCost = [...costs]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, values]) => ({ currency, amount: sumReportedAmounts(values) }));
  return result;
}
