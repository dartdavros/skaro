import assert from 'node:assert/strict';
import { lstat, realpath, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { readRuntimeJournal } from '@skaro/agent-runtime';
import type { AppDb } from '@skaro/core';
import type { ProcessAdmission, ProcessAdmissionPort, SkaroScope } from '@skaro/timeline';
import { AdmissionStore } from '../native/admission-state';
import {
  taskBudgetSource,
  taskBudgetSourcePaths,
  requireTaskBudgetPrefixes,
  type TaskBudgetSource,
} from './task-budget-source';

async function requireRegistryDirectory(path: string) {
  const entry = await lstat(path);
  assert(entry.isDirectory() && !entry.isSymbolicLink());
  assert.equal(await realpath(path), resolve(path), 'Task budget registry is not canonical');
}
async function readCheckpoint(file: string) {
  const entry = await lstat(file);
  assert(entry.isFile() && !entry.isSymbolicLink() && entry.nlink === 1 && entry.size <= 4096);
  assert.equal(await realpath(file), resolve(file));
  return taskBudgetSource.parse(JSON.parse(await readFile(file, 'utf8')));
}

/** A real active native task must register its primary chain before any quote/POST. */
export async function registerTaskBudgetJournal(input: {
  db: AppDb;
  ledger: string;
  scope: SkaroScope;
  admission: ProcessAdmission;
  journal: string;
  admissions: Pick<ProcessAdmissionPort, 'requireActive'>;
  signal: AbortSignal;
}) {
  const { db, scope, admission } = input;
  await input.admissions.requireActive(admission, input.signal);
  assert.equal(scope.kind, 'task');
  assert.equal(scope.projectId, '78bc2cd3-981b-40ed-a395-c6c6bc7da51b');
  assert.equal(scope.taskId, 'T-006');
  const run = db.getRun(scope.runId!);
  assert(
    run &&
      run.agent === 'skaro' &&
      run.projectId === scope.projectId &&
      run.taskId === scope.taskId &&
      run.retiredAt === undefined,
  );
  assert.equal(db.listRuns(scope.projectId, scope.taskId)[0]?.id, run.id);
  assert.equal(run.nativeSessionId, admission.sessionId);
  const state = new AdmissionStore(db, `task:${scope.projectId}:${scope.taskId}:${run.id}`).read();
  assert(state && state.status === 'active' && state.host.pid === process.pid);
  assert.deepEqual(state.admission, admission);
  assert.deepEqual(state.scope, scope);
  const journal = await readRuntimeJournal(input.journal, admission.sessionId);
  assert.deepEqual(journal.state.config?.model?.scope, scope);
  const last = journal.records.at(-1);
  assert(last);
  const source = taskBudgetSource.parse({
    schema: 1,
    projectId: scope.projectId,
    taskId: scope.taskId,
    runId: run.id,
    sessionId: admission.sessionId,
    sequence: last.sequence,
    hash: last.hash,
  });
  const paths = taskBudgetSourcePaths(input.ledger, source);
  assert.equal(resolve(input.journal), paths.journal);
  await mkdir(dirname(paths.checkpoint), { recursive: true, mode: 0o700 });
  await requireRegistryDirectory(dirname(paths.checkpoint));
  try {
    await writeFile(paths.checkpoint, JSON.stringify(source), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    assert.deepEqual(await readCheckpoint(paths.checkpoint), source);
  }
  await input.admissions.requireActive(admission, input.signal);
  return paths.id;
}

/** Append-only checkpoints prevent losing charges through journal truncation or substitution. */
export async function taskBudgetJournals(ledger: string) {
  let names: string[];
  try {
    await requireRegistryDirectory(join(ledger, 'task-sources'));
    names = await readdir(join(ledger, 'task-sources'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  if (names.length > 4096) throw new Error('Task budget registry exceeds its read limit');
  const sources = new Map<string, TaskBudgetSource[]>();
  for (const name of names) {
    if (!/^[a-f0-9]{64}-[1-9][0-9]*\.json$/.test(name))
      throw new Error('Invalid task budget checkpoint');
    const file = join(ledger, 'task-sources', name);
    const source = await readCheckpoint(file);
    const paths = taskBudgetSourcePaths(ledger, source);
    assert.equal(file, paths.checkpoint);
    sources.set(paths.id, [...(sources.get(paths.id) ?? []), source]);
  }
  const result = [];
  for (const [id, checkpoints] of sources) {
    const first = checkpoints[0]!;
    const file = taskBudgetSourcePaths(ledger, first).journal;
    const journal = await readRuntimeJournal(file, first.sessionId);
    requireTaskBudgetPrefixes(journal.records, checkpoints);
    assert.deepEqual(journal.state.config?.model?.scope, {
      kind: 'task',
      projectId: first.projectId,
      taskId: first.taskId,
      runId: first.runId,
    });
    result.push({ id, file, records: journal.records });
  }
  return result;
}
