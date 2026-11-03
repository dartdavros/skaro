import assert from 'node:assert/strict';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { readRuntimeJournal } from '@skaro/agent-runtime';
import type { Services } from '../app-services';
import { readLocalPacket } from './local-packet';
import {
  TASK_WORKFLOW_HASH,
  verifyTaskWorkflowPacket,
  type TaskWorkflowPacket,
} from './task-workflow-packet';
import { taskAdmissionStore, requireTaskProcessExit } from './task-stop-observation';

/** Read real receipts after shutdown; no model host or alternate acceptance record. */
export async function auditTaskWorkflow(
  services: Services,
  data: string,
  packet: TaskWorkflowPacket,
  path: string,
) {
  const attempt = (await readLocalPacket(data, path)) as {
    runId: string;
    cleanupConfirmed: boolean;
    before: { payloadHash: string };
    budget: { requests: number; committedNanoUsd: number };
    primary: { sessionId: string; journalPath: string }[];
  };
  assert(attempt.cleanupConfirmed && attempt.before.payloadHash === TASK_WORKFLOW_HASH);
  assert.equal(attempt.primary.length, 1);
  const primary = attempt.primary[0]!;
  const current = await verifyTaskWorkflowPacket(services, data, packet, {
    runId: attempt.runId,
    sessionId: primary.sessionId,
  });
  assert.deepEqual(current.budget, attempt.budget);
  assert.equal(current.budget.requests, 129);
  const journal = await readRuntimeJournal(primary.journalPath, primary.sessionId);
  assert(journal.state.stopped && journal.state.closed);
  const owners = [];
  for (const run of services.db.listRuns(packet.project.id, 'T-006')) {
    const store = taskAdmissionStore(services, packet.project.id, run.id);
    const state = store.read();
    if (!state) continue;
    await requireTaskProcessExit(store, state.admission.id, false);
    owners.push({ runId: run.id, admissionId: state.admission.id, status: state.status });
  }
  for (const name of ['css/cat-motion.css', 'css/plane-motion.css'])
    await assert.rejects(lstat(join(packet.project.root, name)), { code: 'ENOENT' });
  return {
    ...current,
    modelHostPrepared: false,
    newModelRequests: 0,
    requestExtensionExhausted: true,
    sourceBaselineUnchangedExceptTaskStatus: true,
    fullyAccepted: false,
    owners,
    primary: { ...primary, sequence: journal.records.length, hash: journal.records.at(-1)!.hash },
  };
}
