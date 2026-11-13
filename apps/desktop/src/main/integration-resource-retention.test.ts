import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { resourceId, type ResourceRecord } from '@skaro/core';
import {
  integrationRecoveryRef,
  integrationRemovalMatches,
  integrationResourceBlocker,
  managedIntegrationPath,
} from './integration-resource-retention';

// Pure contract values: no project registration, filesystem fixture, Git or Docker replacement.
const dataDir = resolve('app-data');
const owner = {
  projectId: 'project',
  id: 'operation',
  head: 'a'.repeat(40),
  fingerprint: 'inputs',
  worktree: resolve(dataDir, 'integrations', 'project', 'operation', 'checkout'),
};
const registration = {
  projectId: owner.projectId,
  kind: 'worktree',
  identity: { path: owner.worktree },
  owner: { kind: 'integration', id: owner.id },
  purpose: 'integration',
  ownership: 'registered',
  preservation: 'disposable',
  generation: 1,
  consumers: [],
  state: 'retained',
  source: {
    commit: owner.head,
    recovery: integrationRecoveryRef(owner.id),
    declarationRevision: owner.fingerprint,
  },
} as const;
const record: ResourceRecord = {
  ...registration,
  consumers: [],
  id: resourceId(registration),
  revision: 1,
  createdAt: 0,
  updatedAt: 0,
};

it('requires the exact project and operation allocation, never a sibling or escaping path', () => {
  expect(managedIntegrationPath(dataDir, owner)).toBe(owner.worktree);
  expect(
    managedIntegrationPath(dataDir, { ...owner, worktree: resolve(owner.worktree, '..') }),
  ).toBeUndefined();
  expect(managedIntegrationPath(dataDir, { ...owner, projectId: '..' })).toBeUndefined();
  expect(managedIntegrationPath(dataDir, { ...owner, id: 'other/operation' })).toBeUndefined();
});

it('retains unverified, unique, foreign, consumed and already released candidate generations', () => {
  expect(integrationResourceBlocker(record, owner)).toBeUndefined();
  for (const change of [
    { ownership: 'legacy-unverified' as const },
    { preservation: 'unique' as const },
    { purpose: 'worktree' as const },
    { projectId: 'another' },
    { owner: { kind: 'task' as const, id: owner.id } },
    { state: 'released' as const },
    { consumers: [{ id: 'copy', kind: 'copy' as const, generation: 1 }] },
    { source: { ...record.source, commit: 'b'.repeat(40) } },
    { source: { ...record.source, recovery: 'refs/heads/main' } },
  ])
    expect(integrationResourceBlocker({ ...record, ...change }, owner)).toBeDefined();
});

it('resumes interrupted disposal only for its unchanged operation, commit and resource generation', () => {
  const checkpoint = { ...owner, resourceId: record.id, generation: record.generation };
  expect(integrationRemovalMatches(checkpoint, record, owner)).toBe(true);
  expect(integrationRemovalMatches(null, record, owner)).toBe(false);
  expect(integrationRemovalMatches(checkpoint, undefined, owner)).toBe(false);
  for (const changed of [
    { ...record, generation: 2 },
    { ...record, state: 'released' as const },
    { ...record, id: 'another-resource' },
  ])
    expect(integrationRemovalMatches(checkpoint, changed, owner)).toBe(false);
  expect(
    integrationRemovalMatches(checkpoint, record, { ...owner, fingerprint: 'new-inputs' }),
  ).toBe(false);
  expect(integrationRemovalMatches({ ...checkpoint, head: 'b'.repeat(40) }, record, owner)).toBe(
    false,
  );
});
