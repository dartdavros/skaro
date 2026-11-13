import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { c4Hash, c4PackageStatus, git } from '@skaro/core';
import type { Services } from '../app-services';
import { CompletionStore } from '../completion-store';
import { C4SemanticStore } from '../c4-semantic-store';
import { taskSections } from '../task-body';
import { projectC4Protocol, taskC4Protocol } from '../c4-protocol';
import { eventually } from './resource-workflow-observation';

/** Authoritative post-publication audit and completed-event replay, never another submission. */
export async function auditC4Coordination(s: Services, project: string, directory: string) {
  const context = s.projects.get(project),
    store = new CompletionStore(s.db, project);
  const operation = await eventually(
    () =>
      store
        .operations()
        .findLast(
          (op) =>
            op.results.length === 1 &&
            op.results[0]?.taskId === 'T-012' &&
            op.state === 'completed',
        ),
    (op) => !!op,
    'actual T-012 completed publication',
  );
  assert(operation?.commit);
  context.invalidate();
  const artifacts = await context.store.load(),
    model = artifacts.c4!;
  const task = artifacts.tasks.find((t) => t.id === 'T-012')!;
  assert.equal(task.status, 'done');
  assert(taskSections(task.body).criteria.every((c) => c.done));
  assert.equal(model.revision, 2);
  assert.equal(model.questions.length, 9);
  const run = s.db.latestRun(project, task.id)!;
  const review = new C4SemanticStore(s.db).current(run.id)!;
  assert.equal(taskC4Protocol(s.db, project, run.id), 'impact-v1');
  assert.equal(projectC4Protocol(s.db, project), 'package-v1');
  const source = await readFile(join(context.root, 'css/layout.css'), 'utf8');
  assert.equal(
    c4Hash(source),
    review.observation.files.find((f) => f.path === 'css/layout.css')!.hash,
  );
  const before = review.observation.impact.baseHead;
  const names = (
    await git(context.root, [
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      before,
      operation.commit,
      '--',
      '.',
      ':(exclude).skaro',
    ])
  ).stdout
    .split('\0')
    .filter(Boolean)
    .sort();
  assert.deepEqual(names, ['css/base.css', 'css/layout.css', 'index.html']);
  const original = JSON.parse(
    await readFile(
      join(
        s.dataDir,
        'verification',
        'c4-coordination-a0b4ea4b-a899-4142-80c4-768458a7edf8',
        'baseline-proposal.json',
      ),
      'utf8',
    ),
  );
  const expected = JSON.parse(
    original.files.find((f: { path: string }) => f.path === 'c4/model.json').after,
  );
  expected.revision = 2;
  const relocate = (paths: string[]) =>
    paths.map((p) => (p === 'css/base.css' ? 'css/layout.css' : p));
  for (const element of expected.elements) {
    element.code = relocate(element.code);
    element.evidence = relocate(element.evidence);
    if (element.planned) {
      element.planned.code = relocate(element.planned.code);
      element.planned.evidence = relocate(element.planned.evidence);
    }
  }
  assert.deepEqual(
    model,
    expected,
    'Only actual Git path bindings and publication revision may change',
  );
  const history = await readFile(join(context.root, '.skaro/c4/history/2.json'), 'utf8');
  const tx = JSON.parse(history);
  assert.equal(tx.hash, c4Hash(JSON.stringify(tx.package)));
  assert.equal(await c4PackageStatus(context.root, tx.package), 'applied');
  await assert.rejects(
    c4PackageStatus(context.root, {
      ...tx.package,
      title: tx.package.title + ' changed identity contents',
    }),
    /different contents/,
  );
  const head = (await git(context.root, ['rev-parse', 'HEAD'])).stdout.trim();
  assert.equal(head, operation.commit);
  const replay = await s.runs['engine'].merges.coordinator.merge(project, task.id);
  assert.equal(replay.commit, head);
  assert.equal((await git(context.root, ['rev-parse', 'HEAD'])).stdout.trim(), head);
  assert.equal(await readFile(join(context.root, '.skaro/c4/history/2.json'), 'utf8'), history);
  assert.equal(s.db.listMerges(project, task.id).filter((m) => m.commit === head).length, 1);
  const logs = (await readdir(dirname(review.reviewer!.log))).filter((f) => f.endsWith('.jsonl'));
  assert.equal(logs.length, 1, 'Publication and restarts must not repeat semantic model work');
  const proof = {
    commit: head,
    resultHead: store.result(task.id)!.head,
    operation,
    task: task.id,
    status: task.status,
    revision: model.revision,
    questions: model.questions.length,
    acceptedSemanticFieldsPreserved: true,
    cssBytesPreserved: true,
    replayIdempotent: true,
    mergeRecordedOnce: true,
    modelCalls: 1,
    review: review.id,
    reviewer: review.reviewer,
    publicationInterruptionVerified: false,
    interruptionLimitation:
      'The normal automatic publication completed before fault injection; ordinary restart/replay is not a crash-during-write test.',
  };
  await writeFile(join(directory, 'final-audit.json'), JSON.stringify(proof, null, 2));
  return proof;
}
