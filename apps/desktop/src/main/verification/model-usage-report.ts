import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readRuntimeJournal, reportModelUsage } from '@skaro/agent-runtime';
import { liveBudgetLedger } from '../credentials/live-budget-ledger';
import { configuredPlanHistory } from './configured-plan-history';

/** Historical Cat-pilot model plans only, no new requests or manufactured receipt records. */
export async function verifyReportedModelUsage(data: string, directory: string) {
  const ledger = join(data, 'verification/openrouter-ba4');
  const before = await configuredPlanHistory(ledger, '');
  let requests = 0,
    responses = 0,
    unknownCosts = 0;
  const journals = [];
  const selected = ['session-nativeplan.jsonl', 'session-nativeinput.jsonl', 'session-plans.jsonl'];
  for (const file of before.filter((entry) => selected.includes(entry.name))) {
    const path = join(ledger, file.name);
    const bytes = await readFile(path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    const sessionId = (JSON.parse(bytes.toString('utf8').split('\n')[0]!) as { sessionId: string })
      .sessionId;
    const journal = await readRuntimeJournal(path, sessionId);
    const report = reportModelUsage(journal.records);
    assert.deepEqual(reportModelUsage(journal.records), report);
    // No request was recorded in acceptance without the matching primary intent.
    assert.equal(
      report.requests,
      journal.records
        .flatMap((record) => record.facts)
        .filter((fact) => fact.type === 'effect-intent' && fact.name.startsWith('model:')).length,
    );
    for (const receipt of report.receipts) {
      assert.equal(journal.records[receipt.intent.sequence - 1]?.hash, receipt.intent.hash);
      if (receipt.receipt)
        assert.equal(journal.records[receipt.receipt.sequence - 1]?.hash, receipt.receipt.hash);
    }
    requests += report.requests;
    responses += report.responses;
    unknownCosts += report.costsUnreported;
    journals.push({
      name: file.name,
      requests: report.requests,
      responses: report.responses,
      costsUnreported: report.costsUnreported,
      reportedCost: report.reportedCost,
    });
  }
  assert(requests > 0 && responses > 0);
  const budget = await liveBudgetLedger(ledger);
  assert.equal(journals.length, selected.length);
  assert(requests <= budget.requests);
  assert.deepEqual(await configuredPlanHistory(ledger, ''), before);
  const proof = {
    historicalJournals: journals.length,
    project: 'Cat-pilot',
    requests,
    responses,
    costsUnreported: unknownCosts,
    separateReceiptAndReservation: true,
    exactDecimalTotals: true,
    validatedPrimaryChains: true,
    deterministicReplay: true,
    sourceHashesUnchanged: true,
    modelRequests: 0,
    credentialBytesRead: false,
    budget,
    journals,
  };
  await writeFile(join(directory, 'model-usage-report.json'), JSON.stringify(proof, null, 2));
  return proof;
}
