import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { AppDb } from './appdb.ts';

it('keeps durable cleanup exclusion across real SQLite handles and reopened observers', async () => {
  const temporary = await realpath(tmpdir());
  const directory = await mkdtemp(join(temporary, 'skaro-cleanup-ledger-'));
  const file = join(directory, 'ledger.sqlite');
  const db = AppDb.open(file);
  let observer = AppDb.open(file);
  let complete!: () => void;
  let running: Promise<void> | undefined;
  try {
    const root = await realpath(process.cwd());
    const resource = db.resources.register({
      projectId: root,
      kind: 'cache',
      identity: { path: root },
      owner: { kind: 'project', id: root },
      purpose: 'cache',
      ownership: 'registered',
      preservation: 'reproducible',
      generation: 1,
      state: 'available',
      consumers: [],
    });
    const boundary = new Promise<void>((resolve) => {
      complete = resolve;
    });
    running = db.resources.cleanup.run(resource, 'exact-live-observation', async () => {
      db.resources.cleanup.effect(resource.id);
      await boundary;
      db.resources.update(resource.id, resource.revision, { state: 'released' });
    });
    observer.close();
    observer = AppDb.open(file);
    expect(observer.resources.cleanup.read(resource.id)?.operationId).toBe(
      'exact-live-observation',
    );
    expect(() =>
      observer.resources.update(resource.id, resource.revision, {
        consumers: [{ id: 'observer-access', kind: 'preview', generation: 1 }],
      }),
    ).toThrow('cleanup excludes');
    await expect(
      observer.resources.cleanup.run(resource, 'exact-live-observation', async () => undefined),
    ).rejects.toThrow('live or unverified execution');
    const waiting = observer.admission.request({
      id: randomUUID(),
      projectId: root,
      ownerId: root,
      intentId: randomUUID(),
      checkpoint: 'metadata-observation',
      cost: {
        ramBytes: 0,
        cpuMillis: 0,
        model: 0,
        environment: 0,
        build: 0,
        review: 0,
        diskBytes: {},
      },
      locks: [{ resourceId: resource.id, generation: 1, mode: 'shared' }],
    });
    expect(
      observer.admission.admit(root, waiting.id, waiting.revision, {
        ramBytes: null,
        cpuMillis: null,
        model: null,
        environment: null,
        build: null,
        review: null,
        diskBytes: {},
        accounts: {},
        measuredAt: Date.now(),
        maxAgeMs: 60_000,
      }).reason,
    ).toBe('resource_cleanup_locked');
    const environment = db.resources.register({
      projectId: root,
      kind: 'environment',
      identity: { composeProject: basename(root).toLowerCase() },
      owner: { kind: 'task', id: root },
      purpose: 'task',
      ownership: 'registered',
      preservation: 'disposable',
      generation: 1,
      consumers: [],
      state: 'available',
    });
    const review = db.admission.request({
      id: randomUUID(),
      projectId: root,
      ownerId: `review:${root}`,
      intentId: randomUUID(),
      checkpoint: 'metadata-stop-origin',
      cost: {
        ramBytes: 0,
        cpuMillis: 0,
        model: 0,
        environment: 0,
        build: 0,
        review: 1,
        diskBytes: {},
      },
      locks: [{ resourceId: environment.id, generation: 1, mode: 'shared' }],
    });
    const live = db.admission.admit(root, review.id, review.revision, {
      ramBytes: null,
      cpuMillis: null,
      model: null,
      environment: null,
      build: null,
      review: 1,
      diskBytes: {},
      accounts: {},
      measuredAt: Date.now(),
      maxAgeMs: 60_000,
    });
    const retained = db.admission.stop(root, live.id, live.revision);
    const current = db.resources.get(environment.id)!;
    await expect(
      observer.resources.cleanup.runStop(current, 'exact-origin-stop', async () => undefined, live),
    ).rejects.toThrow('owned review stop authority');
    await db.resources.cleanup.runStop(
      current,
      'exact-origin-stop',
      async () => {
        db.resources.cleanup.reconciled(environment.id);
      },
      live,
    );
    db.admission.release(
      root,
      retained.id,
      retained.revision,
      { [environment.id]: 1 },
      'metadata stop origin verified',
    );
    complete();
    await running;
    expect(observer.resources.cleanup.read(resource.id)).toBeUndefined();
    expect(observer.resources.get(resource.id)?.state).toBe('released');
    expect(db.listProjects()).toEqual([]);
  } finally {
    complete?.();
    await running;
    db.close();
    observer.close();
    await removeMetadataLedger(directory, temporary);
  }
});

async function removeMetadataLedger(directory: string, temporary: string): Promise<void> {
  const target = await realpath(directory);
  if (dirname(target) !== temporary || !basename(target).startsWith('skaro-cleanup-ledger-'))
    throw new Error('Unexpected metadata database cleanup target');
  await rm(target, { recursive: true, force: true });
}
