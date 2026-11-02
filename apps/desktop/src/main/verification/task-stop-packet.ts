import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { Services } from '../app-services';
import { liveBudgetLedger } from '../credentials/live-budget-ledger';
import { configuredPlanHistory } from './configured-plan-history';
import { planPayloadHash } from './model-plan-request';
import { requireTaskStopBudget } from './task-stop-budget';
import { taskStopReviewView, type TaskStopReview } from './task-stop-review';
import { readLocalPacket } from './local-packet';

/** Hash identifies review bytes; invoking live mode still requires separate owner approval. */
export async function readTaskStopPacket(data: string, path: string, hash: string) {
  assert(/^[a-f0-9]{64}$/.test(hash));
  const reviewed = (await readLocalPacket(data, path)) as TaskStopReview;
  assert.equal(planPayloadHash(reviewed), hash);
  assert(
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      reviewed.attemptId,
    ),
  );
  requireTaskStopBudget(reviewed.budgetProposal, reviewed.budgetProposal.baseline);
  return reviewed;
}

export async function requireTaskStopCurrent(
  services: Services,
  data: string,
  reviewed: TaskStopReview,
  current?: { runId: string; sourceId: string; status?: 'todo' | 'in_progress' },
) {
  const view = await taskStopReviewView(services, data, current?.runId, current?.status);
  assert.deepEqual(reviewed, {
    ...view,
    attemptId: reviewed.attemptId,
    budgetProposal: reviewed.budgetProposal,
    priorJournals: reviewed.priorJournals,
  });
  const ledger = join(data, 'verification/openrouter-ba4');
  assert.deepEqual(
    await configuredPlanHistory(ledger, current ? `task:${current.sourceId}` : ''),
    reviewed.priorJournals,
  );
  const budget = await liveBudgetLedger(ledger);
  requireTaskStopBudget(reviewed.budgetProposal, budget);
  return budget;
}
