import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { AppDb, type IncidentProtocol } from '@skaro/core';
import { expect, it } from 'vitest';
import { ProjectCoordinators } from './project-coordinators';
import { coordinationHash, coordinationRequest } from './project-coordinator-request';
import { dispatchProjectOperation } from './coordinator-delivery';
import { coordinationToolReceipt, coordinationToolScopeKey } from './coordination-tool-receipt';
import { IncidentStore } from './incident-store';
import { TaskExecution } from './task-execution';
import {
  recordTaskBlocker,
  confirmTaskBlockerReport,
  recoverTaskBlockerReports,
  taskBlockerReceipt,
} from './task-blocker-receipt';

async function metadata(db: AppDb) {
  const path = await realpath(process.cwd());
  const file = join(path, 'package.json');
  const inputs = coordinationHash(await readFile(file, 'utf8'));
  const project = db.addProject({ name: 'Observed Skaro repository', path });
  const taskId = 'T-016';
  const run = db.createRun({
    projectId: project.id,
    taskId,
    agent: 'codex',
    logPath: file,
    adapterVersion: 'metadata',
  });
  const execution = new TaskExecution(db, run.id);
  execution.start();
  const subscription = { taskId, runId: run.id, inputs, intent: execution.intentVersion() };
  const protocol: IncidentProtocol = {
    cause: 'external',
    code: 'observed_prerequisite_unavailable',
    resourceVersion: inputs,
    condition: 'owner-evidence',
    phase: 'diagnosing',
    attempts: 0,
    subscriptions: [],
  };
  const request = (action: string, scopeKey: string, id = randomUUID()) => ({
    id,
    projectId: project.id,
    action,
    source: { kind: 'worker' as const, id: run.id },
    subject: { kind: 'task' as const, id: taskId },
    inputHash: inputs,
    scopeKey,
    mode: 'control' as const,
  });
  return { project, run, execution, subscription, protocol, request };
}

it('records an explicit owner pause with disabled intent so diagnosis and late repair cannot resume it', async () => {
  const db = AppDb.open(':memory:');
  try {
    const m = await metadata(db);
    const store = new IncidentStore(db, new ProjectCoordinators(db));
    const row = await store.report(
      m.project.id,
      { kind: 'run', id: m.run.id },
      { ...m.protocol, cause: 'owner-decision', code: 'explicit-owner-pause' },
      m.subscription,
      'Owner selected stop in the actual question protocol',
      'worker',
    );
    recordTaskBlocker(db, row, m.subscription, 'Owner selected stop');
    expect(m.execution.read()).toMatchObject({ enabled: false, blockedIncident: row.id });
    expect(m.execution.intentVersion()).toBeGreaterThan(m.subscription.intent);
    expect(m.execution.clearIncident(row.id, m.subscription.intent)).toBe(false);
    recoverTaskBlockerReports(db, m.project.id);
    expect(m.execution.read().enabled).toBe(false);
    expect(db.commands.pending()).toEqual([]);
  } finally {
    db.close();
  }
});

it('records a blocker independently of an uncertain task control and acknowledges its exact durable effect', async () => {
  const db = AppDb.open(':memory:');
  try {
    const m = await metadata(db);
    const lane = `control:task:${m.subscription.taskId}`;
    const old = db.coordination.accept(coordinationRequest(m.request('mcp.resume_task', lane)));
    db.coordination.claim(m.project.id, old.id, {
      expectedRevision: old.revision,
      claimId: randomUUID(),
    });
    db.coordination.recover(m.project.id);
    const id = randomUUID();
    const request = m.request(
      'mcp.report_task_blocker',
      coordinationToolScopeKey('report_task_blocker', id, lane),
      id,
    );
    const coordinators = new ProjectCoordinators(db);
    const store = new IncidentStore(db, coordinators);
    const receipt = await coordinators.execute(request, async () => {
      const row = await store.report(
        m.project.id,
        { kind: 'run', id: m.run.id },
        m.protocol,
        m.subscription,
        'Observed prerequisite is unavailable',
        'worker',
        id,
      );
      recordTaskBlocker(db, row, m.subscription, 'Observed prerequisite is unavailable', id);
      return taskBlockerReceipt(db, m.project.id, id)!;
    });
    expect(receipt.isError).toBeUndefined();
    expect(receipt.structuredContent).toMatchObject({
      blocker: { recorded: true, taskId: m.subscription.taskId, continuationSuspended: false },
      coordination: { operationId: id, registrationConfirmed: true },
    });
    const row = store.list(m.project.id)[0]!;
    expect(row.eventId).toBe(db.coordination.getOperation(m.project.id, id)?.eventId);
    expect(db.coordination.getOperation(m.project.id, id)?.state).toBe('succeeded');
    expect(db.coordination.getOperation(m.project.id, old.id)?.state).toBe('uncertain');
    expect(taskBlockerReceipt(db, m.project.id, old.id)).toBeUndefined();
    await expect(
      store.report(
        m.project.id,
        row.subject,
        m.protocol,
        m.subscription,
        'Unadmitted repeat',
        'worker',
        old.id,
      ),
    ).rejects.toThrow('outside its admitted task operation');
    expect(store.list(m.project.id)).toHaveLength(1);
  } finally {
    db.close();
  }
});

it('recovers a lost report acknowledgement from SQLite without repeating the effect or resuming a stopped task', async () => {
  const db = AppDb.open(':memory:');
  try {
    const m = await metadata(db);
    const id = randomUUID();
    const operation = db.coordination.accept(
      coordinationRequest(m.request('mcp.report_task_blocker', `blocker-report:${id}`, id)),
    );
    db.coordination.claim(m.project.id, id, {
      expectedRevision: operation.revision,
      claimId: randomUUID(),
    });
    const store = new IncidentStore(db, new ProjectCoordinators(db));
    const row = await store.report(
      m.project.id,
      { kind: 'run', id: m.run.id },
      m.protocol,
      m.subscription,
      'Observed prerequisite is unavailable',
      'worker',
      id,
    );
    recordTaskBlocker(db, row, m.subscription, 'Observed prerequisite is unavailable', id);
    m.execution.stop();
    db.coordination.recover(m.project.id);
    expect(db.coordination.getOperation(m.project.id, id)?.state).toBe('uncertain');
    recoverTaskBlockerReports(db, m.project.id);
    recoverTaskBlockerReports(db, m.project.id);
    expect(db.coordination.getOperation(m.project.id, id)).toMatchObject({
      state: 'succeeded',
      evidence: { code: 'task_blocker_report_verified', refs: [{ kind: 'blocker', id: row.id }] },
    });
    expect(taskBlockerReceipt(db, m.project.id, id)?.structuredContent).toMatchObject({
      blocker: { recorded: true, id: row.id },
    });
    expect(store.list(m.project.id)).toHaveLength(1);
    expect(m.execution.read().enabled).toBe(false);
  } finally {
    db.close();
  }
});

it('returns an actual queued claim as coordination_pending and never invents a blocker acknowledgement', async () => {
  const db = AppDb.open(':memory:');
  try {
    const m = await metadata(db);
    const lane = `control:task:${m.subscription.taskId}`;
    const busy = db.coordination.accept(coordinationRequest(m.request('mcp.resume_task', lane)));
    db.coordination.claim(m.project.id, busy.id, {
      expectedRevision: busy.revision,
      claimId: randomUUID(),
    });
    const blocked = db.coordination.accept(
      coordinationRequest(m.request('mcp.request_secret', lane)),
    );
    const result = await coordinationToolReceipt('request_secret', () =>
      dispatchProjectOperation(db.coordination, blocked, async () => ({
        text: await readFile(join(m.project.path, 'package.json'), 'utf8'),
      })),
    );
    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        failure: { category: 'coordination_pending' },
        coordination: { operationId: blocked.id, state: 'queued', retryAllowed: false },
      },
    });
    expect(taskBlockerReceipt(db, m.project.id, blocked.id)).toBeUndefined();
    expect(db.coordination.blockers.list(m.project.id)).toHaveLength(0);
    expect(m.execution.read().blocked).toBeUndefined();
  } finally {
    db.close();
  }
});

it('confirms a report after a real post-effect filesystem error without repeating registration', async () => {
  const db = AppDb.open(':memory:');
  try {
    const m = await metadata(db);
    const id = randomUUID();
    const store = new IncidentStore(db, new ProjectCoordinators(db));
    const operation = db.coordination.accept(
      coordinationRequest(m.request('mcp.report_task_blocker', `blocker-report:${id}`, id)),
    );
    const receipt = await coordinationToolReceipt(
      'report_task_blocker',
      () =>
        dispatchProjectOperation(db.coordination, operation, async () => {
          const row = await store.report(
            m.project.id,
            { kind: 'run', id: m.run.id },
            m.protocol,
            m.subscription,
            'Observed prerequisite is unavailable',
            'worker',
            id,
          );
          recordTaskBlocker(db, row, m.subscription, 'Observed prerequisite is unavailable', id);
          // Native ENOTDIR after the durable effect; no fake server or missing-file fixture.
          return {
            text: await readFile(join(m.project.path, 'package.json', 'package.json'), 'utf8'),
          };
        }),
      () => confirmTaskBlockerReport(db, m.project.id, id),
    );
    expect(receipt.structuredContent).toMatchObject({ blocker: { recorded: true } });
    expect(db.coordination.getOperation(m.project.id, id)).toMatchObject({
      state: 'succeeded',
      evidence: { code: 'task_blocker_report_verified' },
    });
    expect(store.list(m.project.id)).toHaveLength(1);
  } finally {
    db.close();
  }
});
