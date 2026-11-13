import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { managedBuildNetwork, type ManagedBuildApproval } from './managed-build-profile';
import {
  inspectManagedBuildSource,
  requireManagedScratch,
  type ManagedBuildSource,
} from './managed-build-source';

// Pure authority-contract metadata: not a project, Docker response, solve or live-acceptance fixture.
const source: ManagedBuildSource = {
  files: [],
  entries: [],
  bytes: 0,
  nodes: 0,
  base: `python:3.12-slim@sha256:${'a'.repeat(64)}`,
  sourceDigest: 'b'.repeat(64),
  recipeDigest: 'c'.repeat(64),
};
const approval: ManagedBuildApproval = {
  projectId: 'project',
  contextRoot: resolve('backend'),
  sourceDigest: source.sourceDigest,
  recipeDigest: source.recipeDigest,
  profile: 'trusted-static-single-stage-default-egress-v1',
};

it('never grants default egress from source inspection or a mismatched host approval', () => {
  expect(() => managedBuildNetwork('project', approval.contextRoot, source)).toThrow(
    'host_approved_exact_source_profile_required',
  );
  expect(managedBuildNetwork('project', approval.contextRoot, source, approval)).toBe('default');
  for (const changed of [
    { ...approval, projectId: 'other' },
    { ...approval, contextRoot: resolve('other') },
    { ...approval, sourceDigest: 'd'.repeat(64) },
    { ...approval, recipeDigest: 'e'.repeat(64) },
  ])
    expect(() => managedBuildNetwork('project', approval.contextRoot, source, changed)).toThrow(
      'host_approved_exact_source_profile_required',
    );
  expect(managedBuildNetwork('project', approval.contextRoot, { ...source, base: 'scratch' })).toBe(
    'none',
  );
});

it.skipIf(!process.env.SKARO_CACHE_BUILD_SOURCE_CONTEXT)(
  'inspects the explicitly authorized real backend without changing or building it',
  async () => {
    const actual = await inspectManagedBuildSource(process.env.SKARO_CACHE_BUILD_SOURCE_CONTEXT!);
    expect(actual.files).toContain('Dockerfile');
    expect(actual.files).toContain('.env.example');
    expect(actual.files).not.toContain('.env');
    expect(actual.files.some((path) => path.split('/').includes('.skaro'))).toBe(false);
    expect(actual.base).toMatch(/^python:3\.12-slim@sha256:[a-f0-9]{64}$/);
    expect(actual.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(actual.recipeDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(() => requireManagedScratch(`FROM ${actual.base}`)).toThrow('unknown_base_expansion');
    console.info('Authorized backend metadata only', {
      files: actual.files.length,
      bytes: actual.bytes,
      nodes: actual.nodes,
      sourceDigest: actual.sourceDigest,
      recipeDigest: actual.recipeDigest,
    });
  },
  30000,
);
