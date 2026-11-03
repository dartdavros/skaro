import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Timeline, type RuntimeProcessIdentity } from '@skaro/timeline';
import {
  readRuntimeJournal,
  SkaroProjector,
  continueContextChatRequest,
  contextChatRequest,
  restoreRuntime,
  type NativeAdmissionState,
} from '@skaro/agent-runtime';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { Services } from '../app-services';
import { builtinSessionDirectory } from '../builtin-session-directory';
import { taskBudgetSourceId } from '../credentials/task-budget-source';
import { TaskExecution } from '../task-execution';
import { loadTaskHistory } from '../task-history-load';
import { taskAdmissionStore, requireTaskProcessExit } from './task-stop-observation';
import { requireTaskStopInputs } from './task-stop-input';
import { requireTaskStopCurrent } from './task-stop-packet';
import { readLocalPacket } from './local-packet';
import type { TaskStopReview } from './task-stop-review';

/** A new real main/services host restores the genuine task history, without native/model admission. */
export async function verifyTaskStopReplay(
  services: Services,
  data: string,
  reviewed: TaskStopReview,
  hash: string,
  proofPath: string,
) {
  const previous = (await readLocalPacket(data, proofPath)) as {
    owner: RuntimeProcessIdentity;
    proof: {
      project: string;
      taskId: string;
      runId: string;
      payloadHash: string;
      sessionId: string;
      firstExit: NativeAdmissionState;
      secondExit: NativeAdmissionState;
      firstCompletedBeforeStop: boolean;
      modelPostAttempts: number;
      budget: { requests: number; committedNanoUsd: number };
      mainRestart?: { exit: NativeAdmissionState; modelPostAttempts: number };
    };
  };
  const proof = previous.proof;
  assert.equal(proof.project, 'Cat-pilot');
  assert.equal(proof.taskId, 'T-006');
  assert.equal(proof.payloadHash, hash);
  assert.equal(proof.firstCompletedBeforeStop, false);
  assert.equal(proof.modelPostAttempts, 2);
  assert.notEqual(await processBirth(previous.owner.pid), previous.owner.birth);
  const run = services.db.getRun(proof.runId);
  assert(
    run && run.agent === 'skaro' && run.taskId === 'T-006' && run.projectId === reviewed.project.id,
  );
  assert.equal(run.nativeSessionId, proof.sessionId);
  const primary = join(
    builtinSessionDirectory(data, 'tasks', run.id, proof.sessionId),
    'journal.jsonl',
  );
  const raw = join(data, run.logPath);
  const beforePrimary = await readFile(primary);
  const beforeRaw = await readFile(raw);
  const journal = await readRuntimeJournal(primary, proof.sessionId);
  assert(journal.state.closed && journal.state.stopped);
  const inputs = journal.records
    .flatMap((record) => record.facts)
    .filter((fact) => fact.type === 'input');
  requireTaskStopInputs(reviewed, inputs);
  const interrupted = journal.records.find((record) =>
    record.facts.some((fact) => fact.type === 'effect-unknown'),
  );
  assert(interrupted);
  // Actual historical prefix of the verified chain, without a second writer or fabricated records.
  const prefixRecords = journal.records.slice(0, interrupted.sequence);
  const prefix = { records: prefixRecords, state: restoreRuntime(prefixRecords) };
  const firstRequest = {
    route: reviewed.wireComposition.route,
    price: { prompt: 0.5, completion: 2, request: 0 },
    tools: [],
    messages: [{ role: 'user' as const, content: inputs[0]!.input.text }],
  };
  assert.deepEqual(
    continueContextChatRequest({ journal: prefix }, firstRequest),
    contextChatRequest({ journal: prefix }, firstRequest),
  );
  const confirmed = journal.state.continuation?.value as { messages?: unknown[] } | undefined;
  assert(confirmed?.messages?.length);
  const localContinuation = continueContextChatRequest(
    { journal },
    {
      route: reviewed.wireComposition.route,
      price: { prompt: 0.5, completion: 2, request: 0 },
      tools: [],
      messages: [{ role: 'user', content: inputs.at(-1)!.input.text }],
    },
  );
  assert.deepEqual(localContinuation.messages.slice(0, -1), confirmed.messages);
  const expected = new Timeline();
  const projector = new SkaroProjector((event) => expected.apply(event));
  journal.records.forEach((record) => projector.output(record));
  const store = taskAdmissionStore(services, reviewed.project.id, run.id);
  const lastExit = proof.mainRestart?.exit ?? proof.secondExit;
  if (proof.mainRestart) assert.equal(proof.mainRestart.modelPostAttempts, 1);
  assert.deepEqual(await requireTaskProcessExit(store, lastExit.admission.id), lastExit);
  for (const generation of [
    proof.firstExit,
    proof.secondExit,
    ...(proof.mainRestart ? [proof.mainRestart.exit] : []),
  ]) {
    assert.equal(generation.status, 'exited');
    assert(generation.owner);
    assert.notEqual(await processBirth(generation.owner.pid), generation.owner.birth);
  }
  const execution = new TaskExecution(services.db, run.id).read();
  assert.equal(execution.enabled, false);
  const current = {
    runId: run.id,
    sourceId: taskBudgetSourceId(run.id, proof.sessionId),
    status: 'todo' as const,
  };
  const budget = await requireTaskStopCurrent(services, data, reviewed, current);
  assert.deepEqual(budget, proof.budget);
  const restored = await loadTaskHistory({ dataDir: data, db: services.db }, run);
  const again = await loadTaskHistory({ dataDir: data, db: services.db }, run);
  for (const state of [restored.timeline.state, again.timeline.state]) {
    for (const item of expected.state.items) {
      const found = state.items.filter((entry) => entry.id === item.id);
      assert.equal(found.length, 1, 'Restored primary item missing or duplicated');
      assert.deepEqual(found[0], item);
    }
    for (const turn of expected.state.turns) {
      const found = state.turns.filter((entry) => entry.id === turn.id);
      assert.equal(found.length, 1);
      assert.deepEqual(found[0], turn);
    }
  }
  assert.deepEqual(again.timeline.state, restored.timeline.state);
  assert.equal(again.seq, restored.seq);
  assert.deepEqual(await readFile(primary), beforePrimary);
  assert.deepEqual(await readFile(raw), beforeRaw);
  assert.deepEqual(store.read(), lastExit);
  assert.deepEqual(new TaskExecution(services.db, run.id).read(), execution);
  assert.deepEqual(await requireTaskStopCurrent(services, data, reviewed, current), budget);
  return {
    project: 'Cat-pilot',
    taskId: 'T-006',
    runId: run.id,
    sessionId: proof.sessionId,
    payloadHash: hash,
    priorMainExited: true,
    nativeOwnersExited: true,
    repeatedHistoryRestoreEqual: true,
    laterConfirmedConversationReusable: true,
    historicalUnknownStartsFreshConversation: true,
    primaryAndRawBytesUnchanged: true,
    exactPrimaryItems: expected.state.items.length,
    turnsExactlyOnce: expected.state.turns.length,
    priorOwnerInputsRetained: inputs.length,
    budget,
    modelRequests: 0,
    nativeAdmissionsCreated: 0,
    taskC4ConfigurationAndExecutionUnchanged: true,
  };
}
