import { join, resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { git, resourceId, type ResourceRecord } from '@skaro/core';
import { CompletionFixture } from './completion-test-support';
import {
  protectedWorktreeResource,
  worktreeRegistrationConflict,
  recordWorktreeObservation,
} from './worktree-resource-records';

// Pure record construction; the cleanup-fence test uses the existing real Git/SQLite fixture.
function resource(path: string, projectId: string): ResourceRecord {
  const identity = { path };
  return {
    id: resourceId({ projectId, kind: 'worktree', identity }),
    projectId,
    kind: 'worktree',
    identity,
    owner: { kind: 'task', id: 'owner' },
    purpose: 'worktree',
    ownership: 'registered',
    preservation: 'disposable',
    generation: 1,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    consumers: [],
    state: 'retained',
  };
}

it('protects separately registered descendants, ancestors and foreign ownership of a path', () => {
  const checkout = resource(resolve(process.cwd()), 'owner');
  for (const path of [
    checkout.identity.path!,
    resolve(process.cwd(), 'data'),
    resolve(process.cwd(), '..'),
  ]) {
    const other = resource(path, 'another-owner');
    expect(protectedWorktreeResource([checkout, other], checkout)).toBe(true);
    expect(protectedWorktreeResource([checkout, { ...other, state: 'released' }], checkout)).toBe(
      false,
    );
  }
  const sibling = resource(resolve(process.cwd(), '..', 'unrelated-checkout'), 'another-owner');
  expect(protectedWorktreeResource([checkout, sibling], checkout)).toBe(false);
});

it('retains unexpected reappearance and cannot promote an already unknown checkout', () => {
  const checkout = resource(resolve(process.cwd()), 'owner');
  expect(worktreeRegistrationConflict(checkout, checkout, true)).toBeUndefined();
  expect(worktreeRegistrationConflict({ ...checkout, state: 'released' }, checkout, true)).toBe(
    'unexpected-worktree-after-release',
  );
  expect(
    worktreeRegistrationConflict(
      {
        ...checkout,
        ownership: 'legacy-unverified',
        preservation: 'unknown',
      },
      checkout,
      true,
    ),
  ).toBe('registration-conflict');
});

it('reobserves identical source under a real cleanup fence and retains a changed source', async () => {
  const fixture = await CompletionFixture.create();
  const { repo: root, db, projectId } = fixture;
  try {
    await fixture.commit();
    const previous = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(join(root, 'README.md'), 'changed observed source\n');
    await fixture.commit();
    const head = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
    const {
      id: _id,
      revision: _revision,
      createdAt: _created,
      updatedAt: _updated,
      ...registration
    } = resource(root, projectId);
    registration.source = { commit: head, recovery: 'HEAD' };
    const row = db.resources.register(registration);
    await db.resources.cleanup.run(row, 'metadata-reobservation', async () => {
      const unchanged = recordWorktreeObservation(db, {
        registration,
        present: true,
        completed: true,
        reason: 'completed-checkout',
      });
      expect(unchanged.conflict).toBe(false);
      expect(unchanged.record?.revision).toBe(row.revision);
      const changed = recordWorktreeObservation(db, {
        registration: { ...registration, source: { commit: previous, recovery: 'HEAD' } },
        present: true,
        completed: true,
        reason: 'completed-checkout',
      });
      expect(changed.conflict).toBe(true);
      expect(db.resources.get(row.id)?.source).toEqual(registration.source);
      expect(db.resources.get(row.id)?.lastOutcome?.reason).toBe('cleanup-source-changed');
    });
  } finally {
    await fixture.close();
  }
});
