import assert from 'node:assert/strict';
import type { RuntimeModelRequest, RuntimeProcessIdentity } from '@skaro/timeline';
import type { Services } from '../app-services';
import { quoteLiveRequest } from '../credentials/live-budget';
import { requireConfiguredPlanBudget } from './configured-plan-budget';
import { configuredPlanView, type ReviewedConfiguredPlan } from './configured-plan-payload';
import { requireModelPlanEnvelope } from './model-plan-envelope';
import { configuredPlanHistory } from './configured-plan-history';

/** Caller must possess explicit owner permission for this exact reviewed hash/count extension. */
export function configuredPlanPolicy(
  services: Services,
  owner: RuntimeProcessIdentity,
  reviewed: ReviewedConfiguredPlan,
  ledger: string,
) {
  let quotations = 0,
    dispatchPermits = 0;
  const requireCurrent = async (request: RuntimeModelRequest, signal: AbortSignal) => {
    signal.throwIfAborted();
    assert(request.kind === 'chat');
    requireModelPlanEnvelope(request.value, reviewed);
    const current = await configuredPlanView(services, owner);
    assert.deepEqual(current.payload.inspection, reviewed.inspection);
    assert.deepEqual(current.payload.request, reviewed.request);
    assert.deepEqual(current.advertisedPricing, reviewed.advertisedPricing);
    signal.throwIfAborted();
    await requireConfiguredPlanBudget(ledger, reviewed.budget);
    assert.deepEqual(
      await configuredPlanHistory(ledger, `session-configured-${reviewed.attemptId}.jsonl`),
      reviewed.priorJournals,
    );
    signal.throwIfAborted();
  };
  return {
    requests: {
      async reserve(id: string, request: RuntimeModelRequest, signal: AbortSignal) {
        await requireCurrent(request, signal);
        assert(request.kind === 'chat');
        const quote = quoteLiveRequest(request.value, id);
        quotations++;
        return { ...quote };
      },
      async requireDispatch(_id: string, request: RuntimeModelRequest, signal: AbortSignal) {
        await requireCurrent(request, signal);
        dispatchPermits++;
      },
    },
    counts: () => ({ quotations, dispatchPermits }),
  };
}
