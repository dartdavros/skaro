import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { Services } from '../app-services';
import { productVerificationDependencies } from '../builtin-product-dependencies';
import { auditTaskWorkflow } from './task-workflow-audit';
import { readContinuationReview } from './task-continuation-review';
import { requireContinuationBudget, requireContinuationStep } from './task-continuation-budget';
import { workflowModels } from './task-workflow-models';
import { verifyTaskWorkflowLive } from './task-workflow-live';

/** Separate CLI continuation authorized by the owner; ordinary and historical grants stay closed. */
export async function taskContinuationMode(
  args: string[],
  data: string,
  getServices: () => Services,
) {
  const live = args[2] === '--task-workflow-continuation-live';
  if (!live && args[2] !== '--task-workflow-continuation-check') return undefined;
  const { review, original, hash } = await readContinuationReview(
    data,
    args[3]!,
    args[4]!,
    args[5]!,
  );
  const entries = resolve('apps/desktop/out/main');
  const binding = {
    hash,
    requireBudget: requireContinuationBudget,
    requireStep: requireContinuationStep,
    dependencies: live
      ? await productVerificationDependencies(new AbortController().signal, entries)
      : [],
  };
  const models = live ? workflowModels(getServices, data, review, true, binding) : undefined;
  return {
    stage: args[2]!.slice(2),
    options: {
      builtinEntries: entries,
      builtinTasks:
        models?.authorize ??
        (async () => {
          throw new Error('Continuation inspection cannot execute models');
        }),
    },
    async run(services: Services, directory: string) {
      const before = await auditTaskWorkflow(
        services,
        data,
        original,
        review.predecessor.previousAttempt,
      );
      assert.equal(before.runId, review.predecessor.runId);
      assert.deepEqual(before.primary, review.predecessor.primary);
      assert.deepEqual(before.priorJournals, review.predecessor.priorJournals);
      assert.deepEqual(before.budget, review.budgetProposal.baseline);
      if (!models) return { ...before, continuationHash: hash, continuationHostPrepared: false };
      // Same Connection/model, only the explicitly proposed output-token ceiling changes.
      // The owner's instruction to continue under $1 is separate from the preparation-only artifact.
      const saved = services.modelConfiguration.read();
      const route = saved.routes.find((item) => item.id === review.wireComposition.route.routeId);
      assert(route);
      await services.modelSettings.saveRoute(saved.revision, {
        ...route,
        parameters: review.wireComposition.route.parameters,
      });
      const catalog = await services.modelCatalog.read(
        route.connectionId,
        review.wireComposition.route.connectionRevision,
      );
      assert.deepEqual(
        services.modelConfiguration.snapshot(route.id, catalog.models),
        review.wireComposition.route,
      );
      return verifyTaskWorkflowLive(services, data, directory, review, models, {
        rebind: true,
        strict: true,
        continuation: {
          hash,
          requireBudget: requireContinuationBudget,
          prepare: async () => ({ ...before, payloadHash: hash }),
        },
      });
    },
  };
}
