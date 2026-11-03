import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Services } from '../app-services';
import type { TaskWorkflowPacket } from './task-workflow-packet';
import { TASK_WORKFLOW_HASH } from './task-workflow-packet';
import { auditTaskWorkflow } from './task-workflow-audit';
import { actualWorkflowSource } from './task-workflow-review';
import { planPayloadHash } from './model-plan-request';
import { toolCatalog } from '@skaro/agent-runtime';

/** Preparation only. The previous grant cannot authorize this proposal or change its route. */
export async function prepareTaskWorkflowContinuation(
  services: Services,
  data: string,
  directory: string,
  original: TaskWorkflowPacket,
  previousAttempt: string,
) {
  const audit = await auditTaskWorkflow(services, data, original, previousAttempt);
  assert.deepEqual(audit.budget, { requests: 129, committedNanoUsd: 460_686_901 });
  const sources = await Promise.all(
    original.wireComposition.sources.map((item) =>
      actualWorkflowSource(original.project.root, item.path),
    ),
  );
  const runtime = await Promise.all(
    ['index.js', 'native-worker.js', 'agent-runtime-worker.js', 'agent-command-worker.js'].map(
      async (name) => ({
        name,
        sha256: createHash('sha256')
          .update(await readFile(join('apps/desktop/out/main', name)))
          .digest('hex'),
      }),
    ),
  );
  const packet = {
    schema: 1,
    kind: 'cat-pilot-workflow-continuation-proposal',
    authorization: { preparationOnly: true, modelPostAllowed: false, routeChangeAllowed: false },
    predecessor: {
      packetHash: TASK_WORKFLOW_HASH,
      runId: audit.runId,
      primary: audit.primary,
      previousAttempt,
      priorJournals: audit.priorJournals,
    },
    project: original.project,
    wireComposition: {
      ...original.wireComposition,
      sources,
      tools: {
        ...original.wireComposition.tools,
        runtime: toolCatalog().filter(
          (item) =>
            original.wireComposition.tools.runtime.some((old) => old.name === item.name) ||
            item.name === 'review_check_environment',
        ),
      },
      currentRoute: original.wireComposition.route,
      route: {
        ...original.wireComposition.route,
        routeRevision: original.wireComposition.route.routeRevision + 1,
        parameters: { ...original.wireComposition.route.parameters, max_tokens: 2048 },
      },
    },
    actionProposal: original.actionProposal,
    budgetProposal: {
      baseline: audit.budget,
      additionalRequests: 40,
      requestCeiling: 169,
      ceilingNanoUsd: 950_000_000,
      totalOwnerLimitUsd: 1,
      unknownHoldsRetained: true,
      proxy: 'http://127.0.0.1:10809',
      directFallback: false,
    },
    localGuards: {
      ...original.localGuards,
      compiledRuntime: runtime,
      sourceRevisions: sources.map((source) => ({
        path: source.path,
        sha256: createHash('sha256').update(source.text).digest('hex'),
      })),
      checkerRevisions: await Promise.all(
        original.localGuards.checkerRevisions.map(async (item) => ({
          path: item.path,
          sha256: createHash('sha256')
            .update(await readFile(item.path))
            .digest('hex'),
        })),
      ),
    },
    runtimePolicyProposal: {
      toolProtocol: 'inspect-plan-check-before-edit',
      maxStepsPerTurn: 40,
      noProgress: { repeatedResults: 3, consecutiveFailures: 6, persistedAcrossResume: true },
      permissions: audit.settings,
      newPolicyRequiresHandoff: true,
      environmentEvidenceRequired: true,
      allowedDerivatives:
        'Actual tool, command, check, browser, C4 and review results within actionProposal',
      forbidden: [
        'unreviewed sources',
        'model or endpoint substitution',
        'automatic approval',
        'new browser installation',
        'ledger reset',
        'unknown POST replay',
      ],
    },
  };
  const hash = planPayloadHash(packet);
  const path = join(directory, 'task-workflow-continuation-review.json');
  await writeFile(path, JSON.stringify(packet, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return {
    path,
    canonicalSha256: hash,
    budget: audit.budget,
    proposedRequests: 40,
    proposedOutputTokens: 2048,
    modelRequests: 0,
    credentialBytesRead: false,
    ownerReviewRequiredBeforePost: true,
    originalPacketUnchanged: true,
  };
}
