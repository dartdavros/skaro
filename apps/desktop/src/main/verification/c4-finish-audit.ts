import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { c4Hash, git } from '@skaro/core';
import type { Services } from '../app-services';
import { CompletionStore } from '../completion-store';
import { C4SemanticStore } from '../c4-semantic-store';
import { projectC4Protocol, taskC4Protocol } from '../c4-protocol';
import { TaskExecution } from '../task-execution';
import { taskSections } from '../task-body';
import { eventually } from './resource-workflow-observation';
import { latestC4LiveProof } from './c4-live-proof';
import { verifyC4CoordinationBrowser } from './c4-coordination-browser';

/** Final real-state audit after crash recovery, including a fresh published-page browser comparison. */
export async function finishC4Acceptance(s: Services, project: string, directory: string) {
  const recovery = await latestC4LiveProof(s.dataDir, project, 'recover-publication');
  const prepared = await latestC4LiveProof(s.dataDir, project, 'fault-task');
  const task = String(prepared.proof.faultTask.taskId),
    context = s.projects.get(project);
  const store = new CompletionStore(s.db, project);
  const head = (await git(context.root, ['rev-parse', 'HEAD'])).stdout.trim();
  assert.equal(head, recovery.proof.recovery.commit);
  context.invalidate();
  const artifacts = await context.store.load();
  assert.equal(artifacts.c4?.revision, 3);
  assert.equal(artifacts.c4.questions.length, 9);
  assert.equal(projectC4Protocol(s.db, project), 'package-v1');
  const result = [];
  for (const id of ['T-012', task]) {
    const current = artifacts.tasks.find((t) => t.id === id)!;
    assert.equal(current.status, 'done');
    assert(taskSections(current.body).criteria.every((c) => c.done));
    const run = s.db.latestRun(project, id)!;
    assert.equal(taskC4Protocol(s.db, project, run.id), 'impact-v1');
    assert.equal(new TaskExecution(s.db, run.id).read().enabled, false);
    const job = new C4SemanticStore(s.db).current(run.id)!;
    assert(job.state === 'verified' && job.delivered);
    assert.deepEqual(job.verdict!.realized, []);
    assert.equal(s.db.getSetting(`c4.review.${project}.${id}`, null), null);
    const merges = s.db.listMerges(project, id);
    assert.equal(merges.length, 1);
    const before = c4Hash(JSON.stringify(artifacts.c4));
    const replay = await s.runs['engine'].merges.coordinator.merge(project, id);
    assert.equal(replay.commit, merges[0]!.commit);
    assert.equal((await git(context.root, ['rev-parse', 'HEAD'])).stdout.trim(), head);
    assert.equal(c4Hash(JSON.stringify((await context.store.load()).c4)), before);
    assert.equal(s.db.listMerges(project, id).length, 1);
    result.push({
      task: id,
      result: store.result(id)!.head,
      commit: replay.commit,
      review: job.id,
      reviewer: job.reviewer,
      replayIdempotent: true,
    });
  }
  s.runs['engine'].merges.coordinator.changed(project);
  await eventually(
    () =>
      s.db.admission
        .all()
        .filter((l) => l.projectId === project && ['granted', 'retained'].includes(l.state)),
    (leases) => leases.length === 0,
    'confirmed completed-publication reservation reconciliation',
    30000,
  );
  const browser = await verifyC4CoordinationBrowser(s, project, directory, task, true);
  assert.equal(browser.after.pixels, prepared.proof.faultTask.browser.after.pixels);
  const run = s.db.latestRun(project, task)!,
    job = new C4SemanticStore(s.db).current(run.id)!;
  const logs = (await readdir(dirname(job.reviewer!.log))).filter((f) => f.endsWith('.jsonl'));
  assert.equal(logs.length, 2, 'Exactly one semantic model call per authorized rename');
  const config = await readFile(join(context.root, '.skaro/config.yaml'), 'utf8');
  assert(config.includes('run: node --check js/pause-controls.js'));
  const proof = {
    tasks: result,
    head,
    revision: 3,
    questions: 9,
    crashRecovery: recovery.file,
    browser,
    semanticModelCalls: 2,
    activeExecutionReservations: 0,
    preservedPermissions: true,
    configuredCheck: 'node --check js/pause-controls.js',
    physicalTemporaryCheckouts: 'Not deleted by capacity reconciliation; no freed-disk claim',
    retainedWorktrees: (await git(context.root, ['worktree', 'list', '--porcelain'])).stdout,
  };
  await writeFile(join(directory, 'acceptance-audit.json'), JSON.stringify(proof, null, 2));
  return proof;
}
