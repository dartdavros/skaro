import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { AppDb } from './appdb.ts';
import type { ResourceLeaseRequest } from '../resources/admission-model.ts';

// Actual in-memory SQLite protocol operations, with existing repository paths; no FS fixtures or executors.
function setup() {
  const db = AppDb.open(':memory:'),
    project = resolve('.');
  const resource = (path: string, kind: 'worktree' | 'cache') =>
    db.resources.register({
      projectId: project,
      kind,
      identity: { path },
      owner: { kind: 'project', id: project },
      purpose: kind === 'cache' ? 'cache' : 'project-dev',
      ownership: 'registered',
      preservation: kind === 'cache' ? 'reproducible' : 'persistent',
      generation: 1,
      consumers: [],
      state: 'available',
    });
  const source = resource(project, 'worktree'),
    target = resource(join(project, 'packages/core'), 'cache');
  const cost = {
    ramBytes: 0,
    cpuMillis: 0,
    model: 0,
    environment: 0,
    build: 1,
    review: 0,
    diskBytes: {},
  };
  function grant(locks: ResourceLeaseRequest['locks']) {
    const request = db.admission.request({
      id: randomUUID(),
      projectId: project,
      ownerId: project,
      intentId: randomUUID(),
      checkpoint: 'binding-contract',
      cost,
      locks,
    });
    const lease = db.admission.admit(project, request.id, request.revision, {
      ...cost,
      build: 4,
      measuredAt: Date.now(),
      maxAgeMs: 60000,
      accounts: {},
    });
    expect(lease.state).toBe('granted');
    return lease;
  }
  return {
    db,
    project,
    source,
    target,
    grant,
    sourceLock: { resourceId: source.id, generation: 1, mode: 'shared' as const },
    targetLock: { resourceId: target.id, generation: 1, mode: 'exclusive' as const },
  };
}
it('atomically appends a newly created target while preserving the existing source binding', () => {
  const s = setup();
  try {
    const lease = s.grant([s.sourceLock]);
    const bound = s.db.admission.bind(s.project, lease.id, lease.revision, [
      s.sourceLock,
      s.targetLock,
    ]);
    expect(bound.locks).toEqual([s.sourceLock, s.targetLock]);
    expect(bound.revision).toBe(lease.revision + 1);
    for (const id of [s.source.id, s.target.id])
      expect(s.db.resources.get(id)?.consumers.map((c) => c.id)).toEqual([`lease:${lease.id}`]);
    for (const locks of [
      [],
      [s.targetLock],
      [{ ...s.sourceLock, mode: 'exclusive' as const }, s.targetLock],
      [{ ...s.sourceLock, generation: 2 }, s.targetLock],
    ])
      expect(() => s.db.admission.bind(s.project, bound.id, bound.revision, locks)).toThrow(
        'bound generation',
      );
    expect(s.db.admission.get(s.project, bound.id)).toEqual(bound);
  } finally {
    s.db.close();
  }
});
it('keeps the old grant and consumers intact when an appended target has an incompatible consumer', () => {
  const s = setup();
  try {
    const other = s.grant([{ ...s.targetLock, mode: 'shared' }]);
    const lease = s.grant([s.sourceLock]);
    expect(() =>
      s.db.admission.bind(s.project, lease.id, lease.revision, [s.sourceLock, s.targetLock]),
    ).toThrow('incompatible consumer');
    expect(s.db.admission.get(s.project, lease.id)).toEqual(lease);
    expect(s.db.resources.get(s.target.id)?.consumers.map((c) => c.id)).toEqual([
      `lease:${other.id}`,
    ]);
    expect(s.db.resources.get(s.source.id)?.consumers.map((c) => c.id)).toEqual([
      `lease:${lease.id}`,
    ]);
  } finally {
    s.db.close();
  }
});
