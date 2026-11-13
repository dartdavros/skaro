import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { resourceId, resourceOutcome, resourcePatch, resourceRegistration } from './validation.ts';
import type { ResourceRegistration } from './model.ts';

/** Pure contract inputs only; no projects, resources, fixtures or services are created. */
const observation = (): ResourceRegistration => ({
  projectId: resolve(process.cwd()),
  kind: 'worktree',
  identity: { path: resolve(process.cwd()) },
  owner: { kind: 'unknown', id: resolve(process.cwd()) },
  purpose: 'unknown',
  ownership: 'legacy-unverified',
  preservation: 'unknown',
  generation: 1,
  consumers: [],
  state: 'retained',
});

it('does not infer disposable ownership from a path or a Compose-like name', () => {
  const input = observation();
  expect(resourceRegistration(input).ownership).toBe('legacy-unverified');
  expect(() => resourceRegistration({ ...input, preservation: 'disposable' })).toThrow(
    'disposable',
  );
  expect(() => resourceRegistration({ ...input, ownership: 'registered' })).toThrow(
    'identified owner',
  );
  expect(() => resourceRegistration({ ...input, identity: { path: 'relative' } })).toThrow(
    'absolute',
  );
  expect(() => resourceRegistration({ ...input, identity: {} })).toThrow('exact path');
  const named = {
    ...input,
    kind: 'environment' as const,
    identity: { composeProject: 'skaro-name-is-not-ownership' },
  };
  expect(resourceRegistration(named).ownership).toBe('legacy-unverified');
  expect(resourceId(named)).not.toBe(resourceId(input));
  // Adding a second locator must not produce a second ledger ID for the same physical object.
  const both = { path: input.identity.path, composeProject: named.identity.composeProject };
  expect(() => resourceId({ ...named, identity: both })).toThrow('only an exact Compose');
  expect(() => resourceRegistration({ ...named, identity: both })).toThrow('only an exact Compose');
  expect(() => resourceId({ ...input, identity: both })).toThrow('only an exact path');
  expect(() => resourceRegistration({ ...input, kind: 'environment' })).toThrow('Compose identity');
  expect(() => resourceRegistration({ ...input, purpose: 'project-dev' })).toThrow(
    'persistent project',
  );
});

it('keeps physical observations outside stable identity and rejects stale consumers', () => {
  const input = observation();
  expect(resourceId({ ...input, identity: { ...input.identity } })).toBe(resourceId(input));
  expect(() =>
    resourceRegistration({
      ...input,
      consumers: [{ id: 'reader', kind: 'preview', generation: 2 }],
    }),
  ).toThrow('Stale');
  expect(() =>
    resourceRegistration({
      ...input,
      state: 'released',
      consumers: [{ id: 'reader', kind: 'preview', generation: 1 }],
    }),
  ).toThrow('released');
  expect(() => resourcePatch({ owner: { kind: 'project', id: input.projectId } })).toThrow(
    'Unsupported',
  );
  expect(() => resourcePatch({ preservation: 'disposable' })).toThrow('Unsupported');
});

it('requires controlled outcome reasons and a known nonnegative measurement', () => {
  const input = {
    operationId: 'contract-outcome',
    resourceId: resourceId(observation()),
    generation: 1,
    action: 'inspect',
    state: 'retained',
    reason: 'ownership_unverified',
  };
  expect(resourceOutcome(input).reason).toBe('ownership_unverified');
  expect(() => resourceOutcome({ ...input, reason: 'Error: token=secret' })).toThrow(
    'machine reason',
  );
  expect(() => resourceOutcome({ ...input, freedBytes: -1 })).toThrow('measured');
  expect(() => resourceOutcome({ ...input, freedBytes: Number.NaN })).toThrow('measured');
});
