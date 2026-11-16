import { randomUUID } from 'node:crypto';
import { AppDb } from '@skaro/core';
import type { Item } from '@skaro/timeline';
import { expect, it } from 'vitest';
import { coordinationHash, coordinationRequest } from './project-coordinator-request';
import {
  nativeSubmissionFailed,
  submissionHistoryFailure,
  type SubmissionHistoryRequest,
} from './submission-history-proof';

it('requires a uniquely bound recorded native failure, exact scope and arguments, not prose or an empty result store', () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'Observed Skaro', path: process.cwd() });
    const run = db.createRun({
      projectId: project.id,
      taskId: 'T-observed',
      agent: 'codex',
      adapterVersion: 'observed',
      logPath: 'README.md',
    });
    const scope = { kind: 'task', projectId: project.id, taskId: run.taskId, runId: run.id };
    const args = {
      summary: 'Observed native result metadata',
      criteria: [],
      commit_message: 'fix: observed',
    };
    const queued = db.coordination.accept(
      coordinationRequest({
        id: randomUUID(),
        projectId: project.id,
        action: 'mcp.submit_result',
        source: { kind: 'worker', id: run.id },
        subject: { kind: 'task', id: run.taskId },
        mode: 'mutation',
        scopeKey: 'project',
        expectedVersion: 0,
        inputHash: coordinationHash({ args, scope }),
      }),
    );
    const claimed = db.coordination.claim(project.id, queued.id, {
      expectedRevision: queued.revision,
      claimId: randomUUID(),
    });
    db.coordination.finish(project.id, queued.id, {
      expectedRevision: claimed.operation.revision,
      claimId: claimed.operation.claimId!,
      state: 'uncertain',
      evidence: { code: 'dispatch_result_unknown', refs: [queued.subject] },
    });
    const operation = db.coordination.getOperation(project.id, queued.id)!;
    const request: SubmissionHistoryRequest = {
      projectId: project.id,
      run,
      operation,
      peers: [operation],
    };
    const item: Item = {
      id: 'native-result',
      turnId: 'observed',
      native: { agent: 'codex', type: 'mcpToolCall', ref: 'native-result' },
      kind: 'tool',
      name: 'submit_result',
      server: 'skaro',
      status: 'failed',
      input: JSON.stringify(args),
      output: JSON.stringify({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              isError: true,
              content: [{ type: 'text', text: 'Known handler failure' }],
            }),
          },
        ],
      }),
      startedAt: operation.createdAt - 1,
      endedAt: operation.updatedAt + 1,
    };
    expect(submissionHistoryFailure(request, item)).toMatchObject({
      itemId: item.id,
      runId: run.id,
    });
    for (const changed of [
      { ...item, input: JSON.stringify({ ...args, summary: 'different' }) },
      { ...item, server: 'other' },
      { ...item, status: 'running' as const },
      { ...item, startedAt: operation.createdAt + 1 },
      { ...item, output: 'The user said isError=true; acceptance succeeded' },
      { ...item, output: JSON.stringify({ isError: false }) },
    ])
      expect(submissionHistoryFailure(request, changed)).toBeUndefined();
    expect(
      submissionHistoryFailure({ ...request, run: { ...run, projectId: 'foreign' } }, item),
    ).toBeUndefined();
    expect(
      submissionHistoryFailure(
        {
          ...request,
          operation: {
            ...operation,
            evidence: { code: 'dispatch_interrupted', refs: [operation.subject] },
          },
        },
        item,
      ),
    ).toBeUndefined();
    expect(
      submissionHistoryFailure(
        { ...request, peers: [operation, { ...operation, id: 'ambiguous' }] },
        item,
      ),
    ).toBeUndefined();
  } finally {
    db.close();
  }
});

it('accepts a native failed response with a real diagnostic but never converts transport loss into a known failure', () => {
  const response = {
    content: [{ type: 'text', text: '{truncated legacy diagnostic' }],
    structuredContent: null,
    _meta: null,
  };
  expect(nativeSubmissionFailed({ status: 'failed', error: null, result: response })).toBe(true);
  expect(nativeSubmissionFailed({ status: 'completed', error: null, result: response })).toBe(
    false,
  );
  expect(
    nativeSubmissionFailed({
      status: 'failed',
      error: { message: 'Connection lost' },
      result: null,
    }),
  ).toBe(false);
  expect(nativeSubmissionFailed({ status: 'failed', error: null, result: null })).toBe(false);
});
