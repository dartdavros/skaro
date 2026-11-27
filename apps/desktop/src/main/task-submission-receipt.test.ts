import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppDb, git } from '@skaro/core';
import { expect, it } from 'vitest';
import { ProjectCoordinators } from './project-coordinators';
import { coordinationHash, coordinationRequest } from './project-coordinator-request';
import { compactSubmissionReply, submissionOperation } from './task-submission-operation';
import {
  confirmSubmissionReceipt,
  recordSubmissionReceipt,
  recoverSubmissionReceipts,
} from './task-submission-receipt';
import { CompletionStore } from './completion-store';
import { reconcileTaskSubmission } from './task-submission-recovery';
import { TaskExecution } from './task-execution';
import { taskAcceptanceRecoveryNote } from './operation-reissue';
import { coordinationToolReceipt } from './coordination-tool-receipt';
import { taskAgentInput } from './task-agent-input';

// Real SQLite and repository reads only. No task checkout, API/runtime fixture or source mutation.
function observedSubmission(db: AppDb) {
  const project = db.addProject({ name: 'Observed Skaro', path: process.cwd() });
  const run = db.createRun({
    projectId: project.id,
    taskId: 'T-188',
    agent: 'codex',
    adapterVersion: 'observed',
    logPath: 'README.md',
  });
  const scope = { kind: 'task' as const, projectId: project.id, taskId: run.taskId, runId: run.id };
  const request = {
    id: randomUUID(),
    projectId: project.id,
    action: 'mcp.submit_result',
    source: { kind: 'worker' as const, id: run.id },
    subject: { kind: 'task' as const, id: run.taskId },
    mode: 'mutation' as const,
    scopeKey: 'project',
    expectedVersion: 0,
    inputHash: coordinationHash({ scope, observed: 'submission-metadata' }),
  };
  const identity = {
    operationId: request.id,
    inputHash: request.inputHash,
    projectId: project.id,
    taskId: run.taskId,
    runId: run.id,
  };
  return { project, run, scope, request, identity };
}

it('gives the owner follow-up the exact recovery path for an undispatched submission', async () => {
  const db = AppDb.open(':memory:');
  try {
    const { project, scope, request } = observedSubmission(db);
    const controllers = new ProjectCoordinators(db);
    const queued = db.coordination.accept(coordinationRequest(request));
    controllers.recover();
    expect(db.coordination.getOperation(project.id, queued.id)).toMatchObject({
      state: 'rejected',
      evidence: { code: 'restart_requires_new_request' },
    });
    const receipt = await reconcileTaskSubmission(db, process.cwd(), scope, queued.id);
    expect(receipt).toMatchObject({
      structuredContent: { coordination: { dispatched: false, freshCallAllowed: true } },
    });
    expect(receipt.isError).toBeUndefined();
    const note = taskAcceptanceRecoveryNote(db, project.id, scope.taskId);
    expect(taskAgentInput({ text: 'продолжи' }, undefined, true, false, note).text).toContain(
      `mcp.submit_result (${queued.id}) never dispatched`,
    );
    let executions = 0;
    const effect = () => {
      executions += 1;
      return { text: 'Accepted on fresh evidence' };
    };
    const sameCall = await coordinationToolReceipt('submit_result', () =>
      controllers.execute(request, effect),
    );
    expect(sameCall.structuredContent).toMatchObject({
      coordination: { retryAllowed: false, dispatched: false, freshCallAllowed: true },
    });
    expect(executions).toBe(0);
    await controllers.execute({ ...request, id: randomUUID() }, effect);
    expect(executions).toBe(1);
    expect(taskAcceptanceRecoveryNote(db, project.id, scope.taskId)).toBe('');
  } finally {
    db.close();
  }
});

it('records a known native failure as terminal and replays it without dispatch or a project-wide fence', async () => {
  const db = AppDb.open(':memory:');
  try {
    const o = observedSubmission(db),
      controller = new ProjectCoordinators(db);
    let executions = 0;
    const effect = () =>
      submissionOperation(db, o.scope, o.request.id, async () => {
        executions++;
        return {
          text: await readFile(join(process.cwd(), 'package.json', 'package.json'), 'utf8'),
        };
      });
    const result = await controller.execute(o.request, effect, {
      outcome: (reply) => (reply.isError ? 'failed' : 'succeeded'),
    });
    expect(result.isError).toBe(true);
    expect(() =>
      recordSubmissionReceipt(db, {
        ...o.identity,
        state: 'failed',
        reply: {
          ...result,
          structuredContent: { ...result.structuredContent, optional: undefined },
        },
      }),
    ).not.toThrow();
    expect(() =>
      recordSubmissionReceipt(db, {
        ...o.identity,
        state: 'failed',
        reply: { text: 'A different terminal result', isError: true },
      }),
    ).toThrow('different terminal receipt');
    expect(db.coordination.getOperation(o.project.id, o.request.id)?.state).toBe('failed');
    expect(
      await controller.execute(o.request, effect, {
        replayFailed: true,
        replay: () => confirmSubmissionReceipt(db, o.project.id, o.request.id)!,
      }),
    ).toMatchObject({ isError: true });
    expect(executions).toBe(1);
    await expect(
      controller.execute({ ...o.request, id: randomUUID(), expectedVersion: 1 }, () =>
        readFile('package.json', 'utf8'),
      ),
    ).resolves.toContain('skaro');
  } finally {
    db.close();
  }
});

it('recovers the original lost acknowledgement, preserves Stop and rejects queued stale submissions without replaying them', async () => {
  const db = AppDb.open(':memory:');
  try {
    const o = observedSubmission(db),
      controller = new ProjectCoordinators(db);
    const execution = new TaskExecution(db, o.run.id);
    execution.start();
    execution.stop();
    const operation = db.coordination.accept(coordinationRequest(o.request));
    db.coordination.claim(o.project.id, operation.id, {
      expectedRevision: operation.revision,
      claimId: randomUUID(),
    });
    await submissionOperation(db, o.scope, operation.id, async () => ({
      text: 'The validated handler rejected this submission.',
      isError: true,
    }));
    db.coordination.recover(o.project.id);
    const queued = db.coordination.accept(
      coordinationRequest({ ...o.request, id: randomUUID(), expectedVersion: 1 }),
    );
    const other = db.coordination.accept(
      coordinationRequest({
        ...o.request,
        id: randomUUID(),
        subject: { kind: 'task', id: 'T-other' },
        expectedVersion: 1,
      }),
    );
    const reply = await reconcileTaskSubmission(db, process.cwd(), o.scope, operation.id);
    expect(reply.isError).toBe(false);
    expect(reply.structuredContent).toMatchObject({
      recovery: { originalReconciled: true, queuedRejected: [queued.id], effectsRepeated: false },
    });
    expect(db.coordination.getOperation(o.project.id, operation.id)?.state).toBe('failed');
    expect(db.coordination.getOperation(o.project.id, queued.id)?.state).toBe('rejected');
    expect(db.coordination.getOperation(o.project.id, other.id)?.state).toBe('queued');
    const fresh = db.coordination.accept(
      coordinationRequest({ ...o.request, id: randomUUID(), expectedVersion: 1 }),
    );
    await reconcileTaskSubmission(db, process.cwd(), o.scope, operation.id);
    expect(db.coordination.getOperation(o.project.id, fresh.id)?.state).toBe('queued');
    expect(execution.read().enabled).toBe(false);
    recoverSubmissionReceipts(db, o.project.id);
    expect(controller.version(o.project.id)).toBe(1);
    await expect(
      reconcileTaskSubmission(db, process.cwd(), { ...o.scope, taskId: 'T-other' }, operation.id),
    ).resolves.toMatchObject({ isError: true });
    await expect(
      reconcileTaskSubmission(
        db,
        process.cwd(),
        { kind: 'project_chat', projectId: o.project.id, chatId: 'import', importId: 'import' },
        operation.id,
      ),
    ).resolves.toMatchObject({ isError: true });
  } finally {
    db.close();
  }
});

it('uses only the exact accepted SHA receipt and never infers acceptance from another submission or a running handler', async () => {
  const db = AppDb.open(':memory:');
  try {
    const o = observedSubmission(db);
    const operation = db.coordination.accept(coordinationRequest(o.request));
    db.coordination.claim(o.project.id, operation.id, {
      expectedRevision: operation.revision,
      claimId: randomUUID(),
    });
    const store = new CompletionStore(db, o.project.id);
    const head = (await git(process.cwd(), ['rev-parse', 'HEAD'])).stdout.trim();
    const result = {
      taskId: o.run.taskId,
      head,
      branch: 'observed',
      criteria: 'observed',
      message: 'Observed acceptance',
      pendingReview: true,
    };
    store.saveResult(result);
    expect(confirmSubmissionReceipt(db, o.project.id, operation.id)).toBeUndefined();
    store.saveResult({
      ...result,
      submission: { ...o.identity, inputHash: coordinationHash('another submission') },
    });
    expect(confirmSubmissionReceipt(db, o.project.id, operation.id)).toBeUndefined();
    store.saveResult({ ...result, submission: o.identity });
    expect(confirmSubmissionReceipt(db, o.project.id, operation.id)).toBeUndefined();
    db.coordination.recover(o.project.id);
    expect(
      confirmSubmissionReceipt(db, o.project.id, operation.id)?.structuredContent,
    ).toMatchObject({
      submission: { accepted: true, head, pendingProjection: true },
      coordination: { state: 'succeeded' },
    });
    expect(store.result(o.run.taskId)?.pendingReview).toBe(true);
    expect(() =>
      recordSubmissionReceipt(db, {
        ...o.identity,
        runId: 'foreign-run',
        state: 'failed',
        reply: { text: 'no' },
      }),
    ).toThrow();
  } finally {
    db.close();
  }
});

it('keeps oversized diagnostics below the transport budget without changing the recorded success or failure', async () => {
  const observed = await readFile('README.md', 'utf8');
  for (const isError of [true, false]) {
    const reply = compactSubmissionReply({
      text: observed.repeat(100),
      isError,
      structuredContent: { diagnostic: observed.repeat(100) },
    });
    expect(Buffer.byteLength(JSON.stringify(reply))).toBeLessThan(64 * 1024);
    expect(reply.isError === true).toBe(isError);
    expect(reply.structuredContent).toMatchObject({ submission: { responseTruncated: true } });
  }
});
