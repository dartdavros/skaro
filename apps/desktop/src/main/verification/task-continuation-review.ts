import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { toolCatalog } from '@skaro/agent-runtime';
import { readLocalPacket } from './local-packet';
import { planPayloadHash } from './model-plan-request';
import {
  readTaskWorkflowPacket,
  TASK_WORKFLOW_HASH,
  type TaskWorkflowPacket,
} from './task-workflow-packet';
import { requireContinuationBudget } from './task-continuation-budget';

interface ContinuationReview extends TaskWorkflowPacket {
  schema: number;
  kind: string;
  authorization: {
    preparationOnly: boolean;
    modelPostAllowed: boolean;
    routeChangeAllowed: boolean;
  };
  predecessor: {
    packetHash: string;
    runId: string;
    previousAttempt: string;
    priorJournals: { name: string; sha256: string }[];
    primary: { sessionId: string; journalPath: string; sequence: number; hash: string };
  };
  wireComposition: TaskWorkflowPacket['wireComposition'] & {
    currentRoute: TaskWorkflowPacket['wireComposition']['route'];
  };
  localGuards: TaskWorkflowPacket['localGuards'] & {
    compiledRuntime: { name: string; sha256: string }[];
  };
}

/** Fixed successor of the reviewed Cat-pilot package; a caller hash alone grants nothing. */
export async function readContinuationReview(
  data: string,
  path: string,
  hash: string,
  originalPath: string,
) {
  const original = await readTaskWorkflowPacket(data, originalPath, TASK_WORKFLOW_HASH);
  const review = (await readLocalPacket(data, path)) as ContinuationReview;
  assert.equal(planPayloadHash(review), hash);
  assert.equal(review.schema, 1);
  assert.equal(review.kind, 'cat-pilot-workflow-continuation-proposal');
  assert.deepEqual(review.authorization, {
    preparationOnly: true,
    modelPostAllowed: false,
    routeChangeAllowed: false,
  });
  assert.equal(review.predecessor.packetHash, TASK_WORKFLOW_HASH);
  assert.deepEqual(review.project, original.project);
  assert.deepEqual(review.actionProposal, original.actionProposal);
  const wire = review.wireComposition,
    old = original.wireComposition;
  for (const key of ['tasks', 'ownerMessages'] as const) assert.deepEqual(wire[key], old[key]);
  assert.deepEqual(wire.currentRoute, old.route);
  assert.deepEqual(wire.route, {
    ...old.route,
    routeRevision: old.route.routeRevision + 1,
    parameters: { ...old.route.parameters, max_tokens: 2048 },
  });
  for (const key of ['skaro', 'browser'] as const)
    assert.deepEqual(wire.tools[key], old.tools[key]);
  assert.deepEqual(
    wire.tools.runtime,
    toolCatalog().filter(
      (item) =>
        old.tools.runtime.some((previous) => previous.name === item.name) ||
        item.name === 'review_check_environment',
    ),
  );
  assert.equal(wire.sources.length, old.sources.length);
  wire.sources.forEach((item, index) => {
    const expected = old.sources[index]!;
    assert.equal(item.path, expected.path);
    assert.equal(
      item.path.includes('/tasks/T-006-')
        ? item.text.replace(/^status: in_progress$/m, 'status: todo')
        : item.text,
      expected.text,
    );
  });
  requireContinuationBudget(review.budgetProposal, review.budgetProposal.baseline);
  assert.deepEqual(review.localGuards.checkerRevisions, original.localGuards.checkerRevisions);
  for (const item of review.localGuards.checkerRevisions)
    assert.equal(
      createHash('sha256')
        .update(await readFile(item.path))
        .digest('hex'),
      item.sha256,
    );
  assert.deepEqual(
    review.localGuards.compiledRuntime.map((item) => item.name),
    ['index.js', 'native-worker.js', 'agent-runtime-worker.js', 'agent-command-worker.js'],
  );
  for (const item of review.localGuards.compiledRuntime)
    assert.equal(
      createHash('sha256')
        .update(await readFile(join('apps/desktop/out/main', item.name)))
        .digest('hex'),
      item.sha256,
    );
  return { review, original, hash };
}
