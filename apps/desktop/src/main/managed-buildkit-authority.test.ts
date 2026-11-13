import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { AppDb } from '@skaro/core';
import { expect, it } from 'vitest';
import { ApplicationResources } from './application-resources';
import { resourceHolding } from './resource-holding';
import { resourceExecution } from './resource-execution';
import { managedBuilderAuthority } from './managed-buildkit-authority';

// Actual SQLite/AsyncLocalStorage/capability protocol; no Docker client, synthetic app or FS fixtures.
function setup(bound: boolean) {
  const db = AppDb.open(':memory:'),
    root = resolve('.');
  const project = db.addProject({ name: 'authority protocol', path: root });
  const resources = new ApplicationResources(db, root);
  const register = (path: string, kind: 'cache' | 'worktree') =>
    db.resources.register({
      projectId: project.id,
      kind,
      identity: { path },
      owner: { kind: 'project', id: project.id },
      purpose: kind === 'cache' ? 'cache' : 'project-dev',
      ownership: 'registered',
      preservation: kind === 'cache' ? 'reproducible' : 'persistent',
      generation: 1,
      consumers: [],
      state: 'available',
    });
  const source = register(root, 'worktree'),
    target = register(join(root, 'apps/desktop'), 'cache');
  const intentId = randomUUID(),
    cost = {
      ramBytes: 0,
      cpuMillis: 0,
      model: 0,
      environment: 0,
      build: 1,
      review: 0,
      diskBytes: {},
    };
  const sourceLock = { resourceId: source.id, generation: 1, mode: 'shared' as const };
  const targetLock = { resourceId: target.id, generation: 1, mode: 'exclusive' as const };
  const request = db.admission.request({
    id: randomUUID(),
    projectId: project.id,
    ownerId: 'managed-cache:buildkit',
    intentId,
    checkpoint: 'managed-cache-buildkit',
    cost,
    locks: bound ? [sourceLock, targetLock] : [sourceLock],
  });
  const grant = db.admission.admit(project.id, request.id, request.revision, {
    ...cost,
    measuredAt: Date.now(),
    maxAgeMs: 60000,
    accounts: {},
  });
  expect(grant.state).toBe('granted');
  const held = resourceHolding(db, resources.manager, grant);
  const scope = {
    projectId: project.id,
    ownerId: 'managed-cache:buildkit',
    intentId,
    resources,
    signal: new AbortController().signal,
    requireCurrent: () => undefined,
  };
  const subject = { projectId: project.id, resourceId: target.id, generation: 1 };
  return { db, resources, project, target, held, scope, subject };
}
it('keeps a real live grant through both initial late binding and an already bound warm admission', async () => {
  for (const bound of [false, true]) {
    const s = setup(bound);
    try {
      await resourceExecution.run({ ...s.scope, cacheAuthority: s.held }, async () => {
        const authority = managedBuilderAuthority(s.subject);
        expect(authority).toBe(s.held);
        let invoked = 0;
        await s.db.resources.cleanup.runLeased(
          s.db.resources.get(s.target.id)!,
          `authority-protocol:${bound}`,
          authority.lease,
          async () => {
            invoked++;
            s.db.resources.cleanup.reconciled(s.target.id);
          },
        );
        expect(invoked).toBe(1);
        expect(s.db.resources.cleanup.read(s.target.id)).toBeUndefined();
        authority.release('unit_real_maintenance_settled_without_external_effects');
      });
    } finally {
      await s.resources.close();
      s.db.close();
    }
  }
});
it('never falls back to ledger holdings or upgrades a parsed grant into maintenance authority', async () => {
  const s = setup(true);
  try {
    resourceExecution.run(s.scope, () => {
      expect(() => managedBuilderAuthority(s.subject)).toThrow(
        'fresh_exclusive_authority_required',
      );
    });
    const parsed = resourceHolding(
      s.db,
      s.resources.manager,
      s.db.admission.get(s.project.id, s.held.lease.id)!,
    );
    resourceExecution.run({ ...s.scope, cacheAuthority: parsed }, () => {
      expect(() => managedBuilderAuthority(s.subject)).toThrow(
        'fresh_exclusive_authority_required',
      );
      expect(s.db.resources.cleanup.read(s.target.id)).toBeUndefined();
    });
    s.held.release('unit_grant_returned_without_dispatch');
  } finally {
    await s.resources.close();
    s.db.close();
  }
});
