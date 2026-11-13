import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import type { CoordinationRequest } from '../coordination/model.ts';
import { AppDb } from './appdb.ts';

/** Actual filesystem observation in an isolated real ledger; no project/agent/backend is seeded. */
async function observation(): Promise<CoordinationRequest> {
  const projectId = await realpath(process.cwd());
  const file = join(projectId, 'package.json');
  expect((await stat(file)).isFile()).toBe(true);
  const inputHash = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
  const subject = { kind: 'document' as const, id: file, version: inputHash };
  const source = { kind: 'controller' as const, id: file };
  const event = {
    id: randomUUID(),
    projectId,
    kind: 'filesystem.observed',
    source,
    subject,
    inputHash,
  };
  const intent = {
    id: randomUUID(),
    projectId,
    eventId: event.id,
    source,
    action: 'observation.record',
    subject,
    inputHash,
  };
  return {
    event,
    intent,
    operation: {
      id: randomUUID(),
      projectId,
      eventId: event.id,
      intentId: intent.id,
      idempotencyKey: randomUUID(),
      action: intent.action,
      subject,
      scopeKey: 'project:mutation',
      mode: 'mutation',
      expectedVersion: 0,
      inputHash,
    },
  };
}

it('claims once, persists outcomes across two handles/reopen, and rejects stale project mutations', async () => {
  const input = await observation();
  const projectId = input.operation.projectId;
  const directory = await mkdtemp(join(tmpdir(), 'skaro-coordination-ledger-'));
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith('skaro-coordination-ledger-')
  )
    throw new Error('Unexpected verification directory');
  const file = join(directory, 'ledger.sqlite');
  const first = AppDb.open(file);
  const second = AppDb.open(file);
  let reopened: AppDb | undefined;
  let closed = false;
  try {
    const initial = first.coordination.accept(input);
    expect(second.coordination.accept(input)).toEqual(initial);
    expect(first.listProjects()).toEqual([]);
    const identity = first.coordination.get(projectId)?.id;
    expect(second.coordination.ensure(projectId).id).toBe(identity);
    const claimId = randomUUID();
    const claimed = second.coordination.claim(projectId, initial.id, {
      expectedRevision: initial.revision,
      claimId,
    });
    expect(claimed.acquired).toBe(true);
    expect(
      first.coordination.claim(projectId, initial.id, {
        expectedRevision: initial.revision,
        claimId,
      }).acquired,
    ).toBe(false);
    expect(first.coordination.get(projectId)?.version).toBe(1);
    const stale = first.coordination.accept(await observation());
    const rejected = first.coordination.claim(projectId, stale.id, {
      expectedRevision: stale.revision,
      claimId: randomUUID(),
    });
    expect(rejected.acquired).toBe(false);
    expect(rejected.operation.evidence?.code).toBe('stale_project_version');
    const evidence = {
      code: 'filesystem_observation_recorded',
      refs: [input.operation.subject],
      fingerprint: input.operation.inputHash,
    };
    expect(() =>
      first.coordination.finish(projectId, initial.id, {
        expectedRevision: initial.revision,
        claimId,
        state: 'succeeded',
        evidence,
      }),
    ).toThrow('revision changed');
    const outcome = {
      expectedRevision: claimed.operation.revision,
      claimId,
      state: 'succeeded' as const,
      evidence,
    };
    const finished = first.coordination.finish(projectId, initial.id, outcome);
    expect(second.coordination.finish(projectId, initial.id, outcome)).toEqual(finished);
    expect(() =>
      second.coordination.finish(projectId, initial.id, { ...outcome, claimId: randomUUID() }),
    ).toThrow('dispatch identity changed');
    expect(second.coordination.accept(input)).toEqual(finished);
    const repeatedIntent = { ...input.intent, id: randomUUID() };
    const repeatedEvent = {
      ...input,
      intent: repeatedIntent,
      operation: {
        ...input.operation,
        id: randomUUID(),
        intentId: repeatedIntent.id,
        idempotencyKey: randomUUID(),
      },
    };
    expect(() => first.coordination.accept(repeatedEvent)).toThrow('another request');
    expect(first.coordination.getIntent(projectId, repeatedIntent.id)).toBeUndefined();
    const changed = await observation();
    changed.operation.idempotencyKey = input.operation.idempotencyKey;
    expect(() => first.coordination.accept(changed)).toThrow('another request');
    expect(first.coordination.getEvent(projectId, changed.event.id)).toBeUndefined();
    const foreign = await realpath(dirname(projectId));
    expect(first.coordination.getOperation(foreign, initial.id)).toBeUndefined();
    expect(() => first.coordination.finish(foreign, initial.id, outcome)).toThrow('not registered');
    first.close();
    second.close();
    closed = true;
    reopened = AppDb.readOnly(file);
    expect(reopened.coordination.get(projectId)?.id).toBe(identity);
    expect(reopened.coordination.getOperation(projectId, initial.id)).toEqual(finished);
    expect(() => reopened!.coordination.accept(input)).toThrow();
  } finally {
    reopened?.close();
    if (!closed) {
      first.close();
      second.close();
    }
    await rm(directory, { recursive: true, force: true });
  }
});

it('retains uncertain scopes for reconciliation while independent controls remain available', async () => {
  const input = await observation();
  input.operation.mode = 'delivery';
  delete input.operation.expectedVersion;
  input.operation.scopeKey = `delivery:${input.operation.subject.id}`;
  const db = AppDb.open(':memory:');
  try {
    const projectId = input.operation.projectId;
    const initial = db.coordination.accept(input);
    const firstClaim = db.coordination.claim(projectId, initial.id, {
      expectedRevision: initial.revision,
      claimId: randomUUID(),
    });
    const queuedInput = await observation();
    queuedInput.operation.mode = 'delivery';
    delete queuedInput.operation.expectedVersion;
    queuedInput.operation.scopeKey = input.operation.scopeKey;
    const queued = db.coordination.accept(queuedInput);
    expect(
      db.coordination.claim(projectId, queued.id, {
        expectedRevision: queued.revision,
        claimId: randomUUID(),
      }).acquired,
    ).toBe(false);
    const control = await observation();
    control.operation.mode = 'control';
    delete control.operation.expectedVersion;
    control.operation.scopeKey = `control:${input.operation.subject.id}`;
    const independent = db.coordination.accept(control);
    expect(
      db.coordination.claim(projectId, independent.id, {
        expectedRevision: independent.revision,
        claimId: randomUUID(),
      }).acquired,
    ).toBe(true);
    expect(db.coordination.get(projectId)?.version).toBe(0);
    const interrupted = db.coordination
      .recover(projectId)
      .find((operation) => operation.id === initial.id)!;
    expect(interrupted.state).toBe('uncertain');
    expect(db.coordination.recover(projectId)).toEqual([]);
    expect(
      db.coordination.claim(projectId, initial.id, {
        expectedRevision: interrupted.revision,
        claimId: randomUUID(),
      }).acquired,
    ).toBe(false);
    expect(
      db.coordination.claim(projectId, queued.id, {
        expectedRevision: queued.revision,
        claimId: randomUUID(),
      }).acquired,
    ).toBe(false);
    const evidence = { code: 'filesystem_observation_confirmed', refs: [input.operation.subject] };
    expect(() =>
      db.coordination.finish(projectId, initial.id, {
        expectedRevision: firstClaim.operation.revision,
        claimId: firstClaim.operation.claimId!,
        state: 'succeeded',
        evidence,
      }),
    ).toThrow('revision changed');
    db.coordination.reconcile(projectId, initial.id, {
      expectedRevision: interrupted.revision,
      state: 'succeeded',
      evidence,
    });
    expect(
      db.coordination.claim(projectId, queued.id, {
        expectedRevision: queued.revision,
        claimId: randomUUID(),
      }).acquired,
    ).toBe(true);
  } finally {
    db.close();
  }
});

it('persists mechanical decision/blocker state with evidence and CAS without changing project rights/version', async () => {
  const input = await observation();
  const db = AppDb.open(':memory:');
  try {
    const operation = db.coordination.accept(input);
    const common = {
      id: randomUUID(),
      projectId: operation.projectId,
      eventId: input.event.id,
      subject: input.operation.subject,
      inputHash: input.operation.inputHash,
    };
    const decision = db.coordination.decisions.create({
      ...common,
      kind: 'question',
      operationId: operation.id,
    });
    const evidence = { code: 'observation_acknowledged', refs: [operation.subject] };
    db.coordination.decisions.transition(common.projectId, decision.id, {
      expectedRevision: decision.revision,
      state: 'answered',
      evidence,
    });
    expect(() =>
      db.coordination.decisions.transition(common.projectId, decision.id, {
        expectedRevision: decision.revision,
        state: 'denied',
        evidence,
      }),
    ).toThrow('revision changed');
    const blocker = db.coordination.blockers.create({
      ...common,
      id: randomUUID(),
      category: 'resource',
      resolution: { code: 'observation_available', refs: [operation.subject] },
      subscribers: [operation.subject],
    });
    db.coordination.blockers.transition(common.projectId, blocker.id, {
      expectedRevision: blocker.revision,
      state: 'resolved',
      evidence,
    });
    expect(db.coordination.get(common.projectId)?.version).toBe(0);
    expect(db.coordination.getOperation(common.projectId, operation.id)?.state).toBe('queued');
  } finally {
    db.close();
  }
});
