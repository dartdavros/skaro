import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JournalRecord } from '@skaro/agent-runtime';

export interface LiveBudgetReservation {
  kind: 'live-budget';
  schema: 1;
  requestId: string;
  nanoUsd: number;
  requestBytes: number;
}
export function usdNanos(value: string): number {
  if (typeof value !== 'string' || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))
    throw new Error('Invalid cost receipt');
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000)
    throw new Error('Invalid cost receipt');
  return Math.ceil(number * 1_000_000_000);
}
/** Single credential-host owner serializes acceptance calls. Unknown billing keeps its reservation. */
export async function liveBudgetLedger(directory: string) {
  let committedNanoUsd = 0;
  let requests = 0;
  for (const name of await readdir(directory)) {
    if (!/^session(?:-[a-z]+)?\.jsonl$/.test(name)) continue;
    const records = (await readFile(join(directory, name), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as JournalRecord);
    const byId = new Map(records.map((record) => [record.id, record]));
    for (const record of records)
      for (const fact of record.facts) {
        if (fact.type !== 'effect-intent' || fact.name !== 'model:chat') continue;
        requests++;
        const receipt = byId.get(`${fact.id}:result`)?.result.value as
          | { provenance?: { usage?: { cost?: { amount: string; currency: string } | null } } }
          | undefined;
        const cost = receipt?.provenance?.usage?.cost;
        if (cost?.currency === 'USD') committedNanoUsd += usdNanos(cost.amount);
        else {
          const reservation = byId.get(`budget:${fact.id}`)?.result.value as
            LiveBudgetReservation | undefined;
          const amount = reservation?.nanoUsd ?? 50_000_000;
          if (!Number.isSafeInteger(amount) || amount <= 0)
            throw new Error('Invalid persisted budget reservation');
          committedNanoUsd += amount;
        }
      }
  }
  return { requests, committedNanoUsd };
}
