import assert from 'node:assert/strict';
import { lstat } from 'node:fs/promises';
import { readRuntimeJournal } from '@skaro/agent-runtime';
import { join } from 'node:path';
import type { Services } from '../app-services';
import { builtinSessionDirectory } from '../builtin-session-directory';
import { builtinJournalReplay } from '../builtin-journal-replay';
import { taskBudgetSourceId } from '../credentials/task-budget-source';
import { TaskExecution } from '../task-execution';
import { serializeTaskMutation } from '../project-task-mutations';
import { updateSubject } from '../task-subject';
import { taskAdmissionStore } from './task-stop-observation';
import { requireTaskStopCurrent } from './task-stop-packet';
import { taskStopOwnerInput, requireTaskStopInputs } from './task-stop-input';
import { requireTaskProcessExit } from './task-stop-observation';
import type { TaskStopReview } from './task-stop-review';

/** Reuse the genuine failed attempt; never erase its primary journal, unknown receipt or run. */
export async function taskStopRecoverableRun(
  services: Services,
  data: string,
  reviewed: TaskStopReview,
) {
  const projectId = reviewed.project.id;
  const runs = services.db.listRuns(projectId, 'T-006');
  if (!runs.length) return undefined;
  assert.equal(runs.length, 1);
  const run = runs[0]!;
  assert.equal(run.agent, 'skaro');
  assert.equal(run.model, reviewed.launch.model);
  assert.equal(run.retiredAt, undefined);
  assert.equal(run.endedAt, undefined);
  assert.equal(run.worktree, undefined);
  assert.equal(run.branch, undefined);
  assert(run.nativeSessionId);
  const saved = taskAdmissionStore(services, projectId, run.id).read();
  assert(saved && saved.status === 'exited');
  assert.equal(saved.admission.sessionId, run.nativeSessionId);
  assert.deepEqual(saved.scope, { kind: 'task', projectId, taskId: 'T-006', runId: run.id });
  assert.deepEqual(services.db.getSetting(`builtin.run.${run.id}.settings`, null), {
    agent: 'skaro',
    ...reviewed.launch,
  });
  assert.equal(new TaskExecution(services.db, run.id).read().enabled, false);
  const primary = join(
    builtinSessionDirectory(data, 'tasks', run.id, run.nativeSessionId),
    'journal.jsonl',
  );
  const copied = await builtinJournalReplay(join(data, run.logPath), run.nativeSessionId);
  let round = 0;
  if (!saved.owner) {
    assert.equal(saved.reason, 'Builtin task startup failed');
    await assert.rejects(lstat(primary), { code: 'ENOENT' });
    assert.equal(copied.boundary.sequence, 0);
  } else {
    await requireTaskProcessExit(
      taskAdmissionStore(services, projectId, run.id),
      saved.admission.id,
    );
    const journal = await readRuntimeJournal(primary, run.nativeSessionId);
    assert(journal.state.closed && journal.state.stopped);
    assert.deepEqual(journal.state.config?.route, reviewed.wireComposition.route);
    const inputs = journal.records
      .flatMap((record) => record.facts)
      .filter((fact) => fact.type === 'input');
    assert.equal(inputs.length, 1);
    requireTaskStopInputs(reviewed, inputs);
    const second = taskStopOwnerInput(reviewed, 1);
    const rejected = journal.records.find((record) => record.id === `cmd:${second.commandId}`);
    assert.equal(
      rejected?.result.error,
      'Open interactions or unresolved effects prevent context projection',
    );
    assert.deepEqual(rejected.facts, []);
    assert.equal(Object.values(journal.state.effects).length, 1);
    assert(
      Object.values(journal.state.effects).every(
        (effect) => effect.name === 'model:chat' && effect.state === 'unknown',
      ),
    );
    assert.equal(journal.records[copied.boundary.sequence - 1]?.hash, copied.boundary.hash);
    round = 1;
  }
  const current = {
    runId: run.id,
    sourceId: taskBudgetSourceId(run.id, run.nativeSessionId),
    status: 'todo' as const,
    round,
  };
  const budget = await requireTaskStopCurrent(services, data, reviewed, current);
  assert.equal(budget.requests, reviewed.budgetProposal.baseline.requests + round);
  return current;
}

/** Real board transition and ordinary queue/send, retaining the failed startup's run and log. */
export async function resumeTaskStopRun(
  services: Services,
  data: string,
  reviewed: TaskStopReview,
  current: NonNullable<Awaited<ReturnType<typeof taskStopRecoverableRun>>>,
) {
  const context = services.projects.get(reviewed.project.id);
  await serializeTaskMutation(context, async () => {
    assert.deepEqual(await taskStopRecoverableRun(services, data, reviewed), current);
    await updateSubject(context, 'T-006', { status: 'in_progress' });
    context.invalidate();
  });
  services.runs.projectChanged(reviewed.project.id);
  await services.runs.send(
    reviewed.project.id,
    'T-006',
    taskStopOwnerInput(reviewed, 0, current.round),
  );
}
