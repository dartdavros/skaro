import assert from 'node:assert/strict';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { Services } from '../app-services';
import type { RuntimeProcessIdentity } from '@skaro/timeline';
import { planPayloadHash } from './model-plan-request';
import { configuredPlanView, type ReviewedConfiguredPlan } from './configured-plan-payload';
import { requireConfiguredPlanBudget } from './configured-plan-budget';
import { configuredPlanHistory } from './configured-plan-history';

/** The hash identifies reviewed bytes. Separate owner permission is required to invoke live mode. */
export async function readConfiguredPlanReview(
  services: Services,
  data: string,
  owner: RuntimeProcessIdentity,
  path: string,
  hash: string,
) {
  assert(/^[a-f0-9]{64}$/.test(hash));
  const root = await realpath(join(data, 'verification'));
  const actual = await realpath(path);
  const rel = relative(root, actual);
  const stat = await lstat(path);
  assert(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 131_072);
  const reviewed = JSON.parse(await readFile(actual, 'utf8')) as ReviewedConfiguredPlan;
  assert.equal(planPayloadHash(reviewed), hash);
  assert(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(reviewed.attemptId));
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
