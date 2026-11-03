import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RuntimeProcessIdentity } from '@skaro/timeline';
import type { Services } from '../app-services';
import { catPilotVerificationTarget } from './task-verification';
import { modelPlanPayload, planPayloadHash } from './model-plan-request';
import { liveBudgetLedger } from '../credentials/live-budget-ledger';
import {
  requireConfiguredPlanLedger,
  requireConfiguredPlanPrice,
  type ConfiguredPlanBudget,
} from './configured-plan-budget';
import { configuredPlanHistory } from './configured-plan-history';

export async function configuredPlanView(services: Services, owner: RuntimeProcessIdentity) {
  const target = await catPilotVerificationTarget(
    services,
    owner,
    'configured-live-plan',
    'verification-configured-plan-no-active-run',
  );
  const state = await target.verification.acceptance.inspect(
    target.verification.admission,
    new AbortController().signal,
  );
  const configuration = services.modelConfiguration.read();
  const route = configuration.routes.find(
    (entry) => entry.connectionId === 'openrouter-owner' && entry.modelId === 'openai/gpt-4.1-nano',
  );
  assert(route, 'Configured nano route is unavailable');
  const connection = configuration.connections.find((entry) => entry.id === route.connectionId)!;
  const catalog = await services.modelCatalog.read(connection.id, connection.revision);
  const snapshot = services.modelConfiguration.snapshot(route.id, catalog.models);
  assert.equal(
    snapshot.endpoint,
    'https://openrouter.ai/api/v1',
    'Configured plan endpoint differs',
  );
  const actual = catalog.models.find((entry) => entry.id === snapshot.modelId)!;
  requireConfiguredPlanPrice(actual.pricing);
  const payload = modelPlanPayload(state, snapshot);
  await services.modelCatalog.requireCurrent(
    snapshot,
    { kind: 'chat', value: payload.request },
    new AbortController().signal,
  );
  return { target, payload, configuration, advertisedPricing: actual.pricing };
}
export type ReviewedConfiguredPlan = ReturnType<typeof modelPlanPayload> & {
  kind: 'configured-cat-pilot-model-plan';
  attemptId: string;
  budget: ConfiguredPlanBudget;
  priorJournals: Awaited<ReturnType<typeof configuredPlanHistory>>;
  advertisedPricing: Awaited<ReturnType<typeof configuredPlanView>>['advertisedPricing'];
};

/** Preparation only: no native child, credential vault or provider POST. */
export async function prepareConfiguredPlan(
  services: Services,
  directory: string,
  owner: RuntimeProcessIdentity,
  data: string,
) {
  const { payload, configuration, advertisedPricing } = await configuredPlanView(services, owner);
  const ledger = join(data, 'verification/openrouter-ba4');
  const baseline = await liveBudgetLedger(ledger);
  const budget: ConfiguredPlanBudget = {
    baseline,
    additionalRequests: 5,
    ceilingNanoUsd: 950_000_000,
  };
  requireConfiguredPlanLedger(budget, baseline);
  const reviewed: ReviewedConfiguredPlan = {
    ...payload,
    kind: 'configured-cat-pilot-model-plan',
    attemptId: randomUUID(),
    budget,
    priorJournals: await configuredPlanHistory(ledger, ''),
    advertisedPricing,
  };
  const path = join(directory, 'configured-plan-payload.json');
  await writeFile(path, JSON.stringify(reviewed, null, 2), { mode: 0o600, flag: 'wx' });
  assert.deepEqual(services.modelConfiguration.read(), configuration);
  return {
    path,
    sha256: planPayloadHash(reviewed),
    criteria: reviewed.inspection.criteria.length,
    budget,
    rawSourceFiles: 0,
    credentialBytesRead: false,
    modelRequests: 0,
    requiresSeparateOwnerApproval: true,
  };
}
