import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { Services } from '../app-services';
import type { RuntimeProcessIdentity } from '@skaro/timeline';
import { configuredPlanView } from './configured-plan-payload';
import { requireConfiguredPlanBudget } from './configured-plan-budget';
import { configuredPlanHistory } from './configured-plan-history';
import { readConfiguredPlanPacket } from './configured-plan-packet';

/** The hash identifies reviewed bytes. Separate owner permission is required to invoke live mode. */
export async function readConfiguredPlanReview(
  services: Services,
  data: string,
  owner: RuntimeProcessIdentity,
  path: string,
  hash: string,
) {
  const reviewed = await readConfiguredPlanPacket(data, path, hash);
  const view = await configuredPlanView(services, owner);
  assert.deepEqual(reviewed, {
    ...view.payload,
    kind: 'configured-cat-pilot-model-plan',
    attemptId: reviewed.attemptId,
    budget: reviewed.budget,
    priorJournals: reviewed.priorJournals,
    advertisedPricing: view.advertisedPricing,
  });
  assert.deepEqual(
    await configuredPlanHistory(
      join(data, 'verification/openrouter-ba4'),
      `session-configured-${reviewed.attemptId}.jsonl`,
    ),
    reviewed.priorJournals,
  );
  await requireConfiguredPlanBudget(join(data, 'verification/openrouter-ba4'), reviewed.budget);
  return { reviewed, ...view };
}
