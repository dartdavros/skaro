import { expect, it } from 'vitest';
import { git } from '@skaro/core';
import type { CompletionOperation } from './completion-store';
import { completedPublicationReservation } from './completion-recovery-resources';

/** Pure reservation metadata against the actual repository HEAD; no resource/project/backend seeded. */
it('never releases a live, foreign, locked or unfinished publication reservation', async () => {
  const project = process.cwd(),
    head = (await git(project, ['rev-parse', 'HEAD'])).stdout.trim();
  const operation: CompletionOperation = {
    id: head,
    base: 'HEAD',
    commit: head,
    state: 'completed',
    strategy: 'squash',
    results: [
      { taskId: 'C4-2', branch: 'HEAD', head, message: 'Protocol metadata', criteria: head },
    ],
  };
  const lease: Parameters<typeof completedPublicationReservation>[1] = {
    projectId: project,
    ownerId: `publication:${head}`,
    state: 'retained',
    checkpoint: 'worktree',
    locks: [],
    cost: {
      model: 0,
      environment: 0,
      build: 0,
      review: 0,
      ramBytes: 0,
      cpuMillis: 0,
      diskBytes: {},
    },
  };
  expect(completedPublicationReservation(project, lease, operation)).toBe(true);
  expect(completedPublicationReservation(project, { ...lease, state: 'granted' }, operation)).toBe(
    false,
  );
  expect(completedPublicationReservation(project + ':foreign', lease, operation)).toBe(false);
  expect(
    completedPublicationReservation(project, { ...lease, ownerId: 'another-owner' }, operation),
  ).toBe(false);
  expect(
    completedPublicationReservation(
      project,
      { ...lease, locks: [{ resourceId: project, generation: 1, mode: 'shared' }] },
      operation,
    ),
  ).toBe(false);
  expect(
    completedPublicationReservation(
      project,
      { ...lease, cost: { ...lease.cost, model: 1 } },
      operation,
    ),
  ).toBe(false);
  expect(completedPublicationReservation(project, lease, { ...operation, state: 'prepared' })).toBe(
    false,
  );
  expect(completedPublicationReservation(project, lease, { ...operation, external: true })).toBe(
    false,
  );
});
