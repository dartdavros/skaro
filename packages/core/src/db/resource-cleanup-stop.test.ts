import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import { expect, it } from 'vitest';
import { AppDb } from './appdb.ts';
import type { ResourceBudget } from '../resources/admission-model.ts';

async function currentEnvironmentLedger() {
  const db = AppDb.open(':memory:');
  const path = await realpath(process.cwd());
  const resource = db.resources.register({
    projectId: path,
    kind: 'environment',
    identity: { composeProject: basename(path).toLowerCase() },
    owner: { kind: 'task', id: path },
    purpose: 'task',
    ownership: 'registered',
    preservation: 'disposable',
    generation: 1,
    consumers: [],
    state: 'available',
  });
  const budget = (): ResourceBudget => ({
    ramBytes: null,
    cpuMillis: null,
    model: null,
    environment: null,
    build: null,
    review: 2,
    diskBytes: {},
    accounts: {},
    measuredAt: Date.now(),
    maxAgeMs: 60_000,
  });
  const reserve = (ownerId: string) => {
    const waiting = db.admission.request({
      id: randomUUID(),
      projectId: path,
      ownerId,
      intentId: randomUUID(),
      checkpoint: 'stop-lock-metadata',
      cost: {
        ramBytes: 0,
        cpuMillis: 0,
        model: 0,
        environment: 0,
        build: 0,
        review: 1,
        diskBytes: {},
      },
      locks: [{ resourceId: resource.id, generation: 1, mode: 'shared' }],
    });
    return db.admission.admit(path, waiting.id, waiting.revision, budget());
  };
  return { db, resource, reserve };
}

it('holds zero-consumer stop exclusion through verification without permitting removal or renewal', async () => {
  const { db, resource, reserve } = await currentEnvironmentLedger();
  try {
    await db.resources.cleanup.runStop(resource, 'environment-stop', async () => {
      expect(reserve(`review:${resource.owner.id}`).reason).toBe('resource_cleanup_locked');
      expect(() => db.resources.cleanup.effect(resource.id)).toThrow(
        'cannot execute resource removal',
      );
      expect(() =>
        db.resources.update(resource.id, resource.revision, { state: 'released' }),
      ).toThrow('stop cannot remove or renew');
      db.resources.cleanup.effect(resource.id, true, 'stop');
      db.resources.cleanup.externalSettled(resource.id);
      db.resources.cleanup.reconciled(resource.id);
    });
    expect(db.resources.cleanup.read(resource.id)).toBeUndefined();
    expect(db.resources.get(resource.id)).toMatchObject({
      generation: 1,
      state: 'available',
      consumers: [],
    });
  } finally {
    db.close();
  }
});

it('keeps the exact owned shared review lease held and rejects every other consumer or shared authority', async () => {
  const { db, resource, reserve } = await currentEnvironmentLedger();
  try {
    const review = reserve(`review:${resource.owner.id}`);
    expect(review.state).toBe('granted');
    await db.resources.cleanup.runStop(
      db.resources.get(resource.id)!,
      'review-stop',
      async () => {
        expect(db.admission.get(review.projectId, review.id)?.state).toBe('granted');
        expect(db.resources.get(resource.id)?.consumers.map((consumer) => consumer.id)).toEqual([
          `lease:${review.id}`,
        ]);
        db.resources.cleanup.effect(resource.id, true, 'stop');
        db.resources.cleanup.externalSettled(resource.id);
        db.resources.cleanup.reconciled(resource.id);
      },
      review,
    );
    expect(db.admission.get(review.projectId, review.id)?.state).toBe('granted');
    const other = reserve(resource.projectId);
    expect(other.state).toBe('granted');
    await expect(
      db.resources.cleanup.runStop(
        db.resources.get(resource.id)!,
        'review-stop',
        async () => undefined,
        review,
      ),
    ).rejects.toThrow('consumers changed');
    await expect(
      db.resources.cleanup.runStop(
        db.resources.get(resource.id)!,
        'review-stop',
        async () => undefined,
        other,
      ),
    ).rejects.toThrow('owned review stop authority');
    db.admission.release(
      review.projectId,
      review.id,
      review.revision,
      { [resource.id]: 1 },
      'metadata stop verification complete',
    );
    db.admission.release(
      other.projectId,
      other.id,
      other.revision,
      { [resource.id]: 1 },
      'metadata observation complete',
    );
  } finally {
    db.close();
  }
});
