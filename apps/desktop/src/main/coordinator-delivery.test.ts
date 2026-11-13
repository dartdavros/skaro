import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { AppDb } from '@skaro/core';
import { expect, it } from 'vitest';
import { dispatchProjectOperation } from './coordinator-delivery';
import { CoordinationPending } from './project-coordinator-errors';
import { coordinationHash, coordinationRequest } from './project-coordinator-request';

async function observe(db: AppDb) {
  const projectId = await realpath(process.cwd());
  const file = join(projectId, 'package.json');
  const digest = coordinationHash(await readFile(file, 'utf8'));
  const request = coordinationRequest({
    id: randomUUID(),
    projectId,
    action: 'filesystem.observe',
    source: { kind: 'controller', id: file },
    subject: { kind: 'document', id: file, version: digest },
    inputHash: digest,
    mode: 'mutation',
    scopeKey: 'project',
    expectedVersion: db.coordination.ensure(projectId).version,
  });
  return { operation: db.coordination.accept(request), request, file, digest };
}

it('dispatches an actual observation once and replays its saved receipt without repeating the effect', async () => {
  const db = AppDb.open(':memory:');
  try {
    const { operation, file, digest } = await observe(db);
    let observations = 0;
    const effect = async () => {
      observations++;
      return coordinationHash(await readFile(file, 'utf8'));
    };
    const options = {
      evidence: (fingerprint: string) => ({
        code: 'filesystem_observed',
        refs: [operation.subject],
        fingerprint,
      }),
      replay: () =>
        db.coordination.getOperation(operation.projectId, operation.id)!.evidence!.fingerprint!,
    };
    const outcomes = await Promise.allSettled([
      dispatchProjectOperation(db.coordination, operation, effect, options),
      dispatchProjectOperation(db.coordination, operation, effect, options),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find((result) => result.status === 'rejected')).toMatchObject({
      reason: expect.any(CoordinationPending),
    });
    expect(await dispatchProjectOperation(db.coordination, operation, effect, options)).toBe(
      digest,
    );
    expect(observations).toBe(1);
    expect(db.coordination.get(operation.projectId)?.version).toBe(1);
    expect(db.listProjects()).toEqual([]);
  } finally {
    db.close();
  }
});

it('rejects revoked authority before dispatch but retains an accepted command during shutdown', async () => {
  const db = AppDb.open(':memory:');
  try {
    const { operation, file } = await observe(db);
    let observations = 0;
    const effect = async () => {
      observations++;
      return readFile(file, 'utf8');
    };
    await expect(
      dispatchProjectOperation(db.coordination, operation, effect, {
        validate: () => {
          throw new Error('Admission revoked');
        },
      }),
    ).rejects.toThrow('Admission revoked');
    expect(db.coordination.getOperation(operation.projectId, operation.id)).toMatchObject({
      state: 'rejected',
      evidence: { code: 'dispatch_preflight_rejected' },
    });
    const queued = (await observe(db)).operation;
    await expect(
      dispatchProjectOperation(db.coordination, queued, effect, {
        validate: () => {
          throw new CoordinationPending(queued);
        },
      }),
    ).rejects.toBeInstanceOf(CoordinationPending);
    expect(db.coordination.getOperation(queued.projectId, queued.id)?.state).toBe('queued');
    expect(observations).toBe(0);
    expect(db.coordination.get(operation.projectId)?.version).toBe(0);
    await dispatchProjectOperation(db.coordination, queued, effect);
    expect(observations).toBe(1);
  } finally {
    db.close();
  }
});

it('records a terminal failure receipt without treating it as a rollback or retry permission', async () => {
  const db = AppDb.open(':memory:');
  try {
    const { operation, file } = await observe(db);
    // Genuine filesystem failure; no fake service or temporary missing file is created.
    const effect = async () => {
      try {
        await readFile(join(file, 'package.json'));
        return { isError: false };
      } catch {
        return { isError: true };
      }
    };
    expect(
      await dispatchProjectOperation(db.coordination, operation, effect, {
        outcome: (result) => (result.isError ? 'failed' : 'succeeded'),
        evidence: () => ({
          code: 'handler_failed_partial_effects_possible',
          refs: [operation.subject],
        }),
      }),
    ).toEqual({ isError: true });
    expect(db.coordination.getOperation(operation.projectId, operation.id)?.state).toBe('failed');
    await expect(
      dispatchProjectOperation(db.coordination, operation, effect),
    ).rejects.toBeInstanceOf(CoordinationPending);
    const next = await observe(db);
    await dispatchProjectOperation(db.coordination, next.operation, () =>
      readFile(next.file, 'utf8'),
    );
    expect(db.coordination.getOperation(next.operation.projectId, next.operation.id)?.state).toBe(
      'succeeded',
    );
  } finally {
    db.close();
  }
});

it('reopens an effect without a delivery receipt, holds it uncertain, and reconciles from its real ledger', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'skaro-coordinator-dispatch-'));
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith('skaro-coordinator-dispatch-')
  )
    throw new Error('Unexpected verification directory');
  const file = join(directory, 'ledger.sqlite');
  let db = AppDb.open(file);
  try {
    const { operation } = await observe(db);
    const { projectId, id } = operation;
    db.coordination.claim(projectId, id, {
      expectedRevision: operation.revision,
      claimId: randomUUID(),
    });
    const resource = db.resources.register({
      projectId,
      kind: 'worktree',
      identity: { path: projectId },
      owner: { kind: 'unknown', id: projectId },
      purpose: 'unknown',
      ownership: 'legacy-unverified',
      preservation: 'unknown',
      generation: 1,
      consumers: [],
      state: 'retained',
    });
    db.resources.recordOutcome({
      operationId: id,
      resourceId: resource.id,
      generation: 1,
      action: 'inspect',
      state: 'retained',
      reason: 'ownership_unverified',
    });
    // End the real connection after its effect but before a coordinator receipt.
    db.close();
    db = AppDb.open(file);
    db.coordination.recover(projectId);
    let redispatches = 0;
    const effect = async () => {
      redispatches++;
      return readFile(join(projectId, 'package.json'), 'utf8');
    };
    await expect(
      dispatchProjectOperation(db.coordination, operation, effect),
    ).rejects.toBeInstanceOf(CoordinationPending);
    const uncertain = db.coordination.getOperation(projectId, id)!;
    expect(uncertain.state).toBe('uncertain');
    const receipt = db.resources
      .outcomes(resource.id)
      .find((outcome) => outcome.operationId === id)!;
    expect(receipt.reason).toBe('ownership_unverified');
    db.coordination.reconcile(projectId, id, {
      expectedRevision: uncertain.revision,
      state: 'succeeded',
      evidence: {
        code: 'resource_observation_confirmed',
        refs: [{ kind: 'resource', id: resource.id }],
        fingerprint: coordinationHash(receipt),
      },
    });
    const saved = await dispatchProjectOperation(db.coordination, operation, effect, {
      replay: () => db.coordination.getOperation(projectId, id)!.evidence!.fingerprint!,
    });
    expect(saved).toBe(coordinationHash(receipt));
    expect(redispatches).toBe(0);
    expect(db.resources.outcomes(resource.id)).toHaveLength(1);
    expect(db.listProjects()).toEqual([]);
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
