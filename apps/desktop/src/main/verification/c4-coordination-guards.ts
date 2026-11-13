import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectC4Code, inspectC4Model, rebaseC4ImpactModel } from '@skaro/core';
import type { Services } from '../app-services';
import { c4SemanticSnapshot } from '../c4-semantic-snapshot';
import { c4SemanticContext, c4SemanticContextHash } from '../c4-semantic-context';
import { candidateC4Model } from '../c4-candidate';
import { C4SemanticStore } from '../c4-semantic-store';
import { inspectSemanticC4Review } from '../c4-semantic-gate';
import { c4RealizationScopeProblems } from '../c4-realization-scope';
import { taskC4Protocol, projectC4Protocol } from '../c4-protocol';
import { coordinatorSourceAudit } from './coordinator-source-audit';

/** Counterfactuals exist only in memory; actual registered sources and accepted model stay intact. */
export async function verifyC4CoordinationGuards(s: Services, project: string, directory: string) {
  const context = s.projects.get(project),
    run = s.db.latestRun(project, 'T-012');
  assert(run?.worktree);
  const source = await coordinatorSourceAudit(context.root),
    artifacts = await context.store.load();
  const model = artifacts.c4!;
  const raw = JSON.stringify(model);
  const snapshot = await c4SemanticSnapshot(s.db, context, 'T-012', run.id, false);
  const job = new C4SemanticStore(s.db).current(run.id)!;
  assert(job.state === 'verified' && job.delivered && job.reviewer?.logHash);
  const consumed = await inspectSemanticC4Review(s.db, context, 'T-012', run.id);
  assert.equal(consumed.semanticReceipt, job.id);
  assert.equal(
    s.db.getSetting(`c4.review.${project}.T-012`, null),
    null,
    'New semantic evidence must not populate the worker-authored legacy acceptance key',
  );
  assert.equal(taskC4Protocol(s.db, project, run.id), 'impact-v1');
  assert.equal(projectC4Protocol(s.db, project), 'package-v1');
  const local = snapshot.semantic.elements.find((e) =>
    snapshot.observation.scope.elements.includes(e.id),
  )!;
  const other = model.elements.find((e) => !snapshot.semantic.elements.some((a) => a.id === e.id))!;
  assert(local && other, 'Use genuinely disjoint objects from the real accepted model');
  const hash = (c4: typeof model) =>
    c4SemanticContextHash({
      ...c4SemanticContext({ ...artifacts, c4 }, 'T-012', snapshot.observation.scope),
      preservation: snapshot.preservation,
    });
  const unrelated = structuredClone(model);
  unrelated.revision++;
  unrelated.elements.find((e) => e.id === other.id)!.description +=
    ' [counterfactual concurrent edit]';
  assert.equal(hash(unrelated), snapshot.contextHash);
  const proposed = structuredClone(model);
  proposed.elements.find((e) => e.id === local.id)!.description += ' [counterfactual local edit]';
  assert.notEqual(hash(proposed), snapshot.contextHash);
  const rebased = rebaseC4ImpactModel(model, proposed, unrelated);
  assert.equal(
    rebased.elements.find((e) => e.id === other.id)!.description,
    unrelated.elements.find((e) => e.id === other.id)!.description,
  );
  const overlapping = structuredClone(model);
  overlapping.elements.find((e) => e.id === local.id)!.description +=
    ' [different concurrent local edit]';
  assert.throws(() => rebaseC4ImpactModel(model, proposed, overlapping), /overlapping/);
  const candidate = await candidateC4Model(model, [], {
    root: run.worktree,
    base: consumed.baseHead,
  });
  assert.deepEqual(inspectC4Model(candidate), []);
  assert.deepEqual(await inspectC4Code(run.worktree, candidate), []);
  const missing = structuredClone(candidate);
  missing.elements
    .find((e) => e.id === local.id)!
    .code.push('__c42_missing_source_must_not_exist__');
  assert((await inspectC4Code(run.worktree, missing)).length > 0);
  const partial = model.elements.find((parent) =>
    model.elements.some(
      (child) => child.parent === parent.id && (child.state === 'planned' || child.planned),
    ),
  );
  if (partial) assert(c4RealizationScopeProblems(model, [partial.id]).length > 0);
  assert.deepEqual(
    candidate.elements.map((e) => [e.id, e.state, !!e.planned]),
    model.elements.map((e) => [e.id, e.state, !!e.planned]),
  );
  assert.equal(candidate.questions.length, 9);
  assert.equal(JSON.stringify((await context.store.load()).c4), raw);
  assert.deepEqual(await coordinatorSourceAudit(context.root), source);
  const proof = {
    run: run.id,
    review: job.id,
    reviewer: job.reviewer,
    scope: snapshot.observation.scope,
    disjoint: [local.id, other.id],
    disjointReviewRetained: true,
    overlappingReviewInvalidated: true,
    overlappingRebaseRefused: true,
    missingPathRefused: true,
    partialParent: partial?.id,
    plannedCurrentPreserved: true,
    questions: 9,
    legacyKeyUntouched: true,
    originalModelUntouched: true,
    source,
  };
  await writeFile(join(directory, 'guard-checks.json'), JSON.stringify(proof, null, 2));
  return proof;
}
