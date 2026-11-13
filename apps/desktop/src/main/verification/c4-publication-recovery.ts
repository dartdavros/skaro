import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  c4Hash,
  git,
  type AppDb,
  type C4Model,
  type CoordinationOperation,
  type RunRecord,
} from '@skaro/core';
import type { Services } from '../app-services';
import { TaskRunProcesses } from '../task-run-processes';
import { TaskExecution } from '../task-execution';
import { CompletionStore, type CompletionOperation } from '../completion-store';
import { C4SemanticStore } from '../c4-semantic-store';
import { eventually } from './resource-workflow-observation';

interface Checkpoint {
  projectId: string;
  taskId: string;
  originalModel: C4Model;
  reviewNativeSessionId: string;
  reviewLogCount: number;
  pid: number;
  before: string;
  commit: string;
  operation: CompletionOperation;
  journal: string;
  journalHash: string;
  run: RunRecord;
  pending: CoordinationOperation[];
}

/** Stop only the exact old registered task process before any project service can resume. */
export async function prepareC4PublicationRecovery(db: AppDb, data: string, project: string) {
  const checkpoints = [];
  for (const name of await readdir(join(data, 'verification'))) {
    if (!name.startsWith('c4-coordination-')) continue;
    const path = join(data, 'verification', name, 'crash-checkpoint.json');
    const raw = await readFile(path, 'utf8').catch(() => undefined);
    if (!raw) continue;
    const value = JSON.parse(raw) as Checkpoint;
    if (value.projectId === project) checkpoints.push({ path, value });
  }
  assert.equal(checkpoints.length, 1, 'Use the one genuine interrupted publication');
  const checkpoint = checkpoints[0]!;
  const run = db.latestRun(project, checkpoint.value.taskId);
  assert.equal(run?.id, checkpoint.value.run.id);
  assert.equal(checkpoint.value.run.projectId, project);
  assert.equal(checkpoint.value.operation.results[0]?.taskId, checkpoint.value.taskId);
  assert.equal(checkpoint.value.operation.commit, checkpoint.value.commit);
  assert.equal(
    c4Hash(await readFile(checkpoint.value.journal, 'utf8')),
    checkpoint.value.journalHash,
    'The actual interrupted publication journal must match its durable checkpoint',
  );
  await new TaskRunProcesses(db).stop(run!.id);
  new TaskExecution(db, run!.id).stop();
  return checkpoint;
}

/** Normal Git/Completion recovery reads its genuine journal; no model call or write is replayed. */
export async function verifyC4PublicationRecovery(
  s: Services,
  project: string,
  directory: string,
  checkpoint: Awaited<ReturnType<typeof prepareC4PublicationRecovery>>,
) {
  const context = s.projects.get(project),
    saved = checkpoint.value;
  s.resources.reconcileProcess(project, saved.run.id);
  assert.equal((await git(context.root, ['rev-parse', 'HEAD'])).stdout.trim(), saved.commit);
  s.runs['engine'].merges.coordinator.changed(project);
  const store = new CompletionStore(s.db, project);
  const operation = await eventually(
    () => store.operations().find((op) => op.id === saved.operation.id),
    (op) => op?.state === 'completed',
    'normal interrupted C4 publication recovery',
    120000,
  );
  assert(operation?.commit);
  context.invalidate();
  const artifacts = await context.store.load();
  assert.equal(artifacts.tasks.find((t) => t.id === saved.taskId)?.status, 'done');
  const revision = saved.originalModel.revision + 1;
  assert.equal(artifacts.c4?.revision, revision);
  assert.equal(artifacts.c4.questions.length, 9);
  assert(
    artifacts.c4.elements.every(
      (e) => ![...e.code, ...(e.planned?.code ?? [])].includes('js/controls.js'),
    ),
  );
  const model = structuredClone(saved.originalModel);
  model.revision = revision;
  const relocate = (paths: string[]) =>
    paths.map((p) => (p === 'js/controls.js' ? 'js/pause-controls.js' : p));
  for (const e of model.elements) {
    e.code = relocate(e.code);
    e.evidence = relocate(e.evidence);
    if (e.planned) {
      e.planned.code = relocate(e.planned.code);
      e.planned.evidence = relocate(e.planned.evidence);
    }
  }
  assert.deepEqual(
    artifacts.c4,
    model,
    'Preserve all accepted semantics; follow only the authorized Git rename',
  );
  const review = new C4SemanticStore(s.db).current(saved.run.id)!;
  assert.equal(
    c4Hash(await readFile(join(context.root, 'js/pause-controls.js'), 'utf8')),
    review.observation.files.find((f) => f.path === 'js/pause-controls.js')!.hash,
  );
  const history = await readFile(
    join(context.root, '.skaro/c4/history', `${revision}.json`),
    'utf8',
  );
  const tx = JSON.parse(history);
  assert.equal(tx.hash, c4Hash(JSON.stringify(tx.package)));
  assert.equal(
    s.db.listMerges(project, saved.taskId).filter((m) => m.commit === saved.commit).length,
    1,
  );
  await assert.rejects(readdir(dirname(saved.journal)), { code: 'ENOENT' });
  const reconciled = [];
  for (const old of saved.pending) {
    const current = s.db.coordination.getOperation(project, old.id)!;
    if (current.state === 'uncertain')
      reconciled.push(
        s.coordinators.reconcile(
          project,
          old.id,
          {
            code: 'actual_c4_publication_verified',
            fingerprint: saved.commit,
            refs: [
              { kind: 'task', id: saved.taskId, version: saved.commit },
              { kind: 'document', id: '.skaro/c4/model.json', version: revision },
            ],
          },
          'succeeded',
        ),
      );
  }
  assert.equal(review.reviewer?.nativeSessionId, saved.reviewNativeSessionId);
  assert.equal(
    (await readdir(dirname(review.reviewer!.log))).filter((f) => f.endsWith('.jsonl')).length,
    saved.reviewLogCount,
  );
  assert.equal(new TaskExecution(s.db, saved.run.id).read().enabled, false);
  assert.equal(s.db.getSetting(`run.${saved.run.id}.processes`, []).length, 0);
  const proof = {
    checkpoint: checkpoint.path,
    operation,
    commit: saved.commit,
    revision: artifacts.c4.revision,
    questions: 9,
    plannedCurrentPreserved: true,
    mergeRecordedOnce: true,
    review: review.id,
    reviewer: review.reviewer,
    noRepeatedModelCall: true,
    reconciled,
    historyHash: c4Hash(history),
  };
  await writeFile(join(directory, 'publication-recovery.json'), JSON.stringify(proof, null, 2));
  return proof;
}
