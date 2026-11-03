import { realpath } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { captureDependencies } from './dependencies.ts';
import { fingerprint } from './inputs.ts';
import {
  reviewedCheckEnvironment,
  verificationCommandHash,
  verificationReviewSchema,
} from './environment-review.ts';
import { sameObservationHost } from './observation-source.ts';

it('binds review metadata to measured dependencies and exact command or observation identity', async () => {
  // Actual runtime binary measurement; command/observation descriptors are policy DTOs, not receipts.
  const dependencies = await captureDependencies(
    [{ id: 'runtime', path: await realpath(process.execPath) }],
    new AbortController().signal,
  );
  const command = {
    kind: 'command-check' as const,
    command: 'node --version',
    cwd: process.cwd(),
    shell: 'cmd',
    criteria: ['criterion-2', 'criterion-1'],
    timeoutMs: 120000,
  };
  const source = {
    name: 'mcp__browser__browser_evaluate',
    revision: 'a'.repeat(64),
    argsHash: 'b'.repeat(64),
  };
  const review = {
    revision: 'c'.repeat(64),
    criteriaRevision: 'd'.repeat(64),
    dependencies: fingerprint(dependencies),
    commands: [verificationCommandHash(command)],
    observations: [source],
    assumptions: [
      {
        concern: 'external services and mutable environment',
        rationale: 'Owner-reviewed static local document only',
      },
    ],
  };
  const current = { dependencies };
  expect(reviewedCheckEnvironment(undefined, command, current)).toBeUndefined();
  expect(reviewedCheckEnvironment(review, command, current)).toMatchObject({
    coverage: 'host-reviewed-assumptions',
    assumptions: review.assumptions,
  });
  expect(
    reviewedCheckEnvironment(
      review,
      { ...command, criteria: [...command.criteria].reverse() },
      current,
    ),
  ).toBeDefined();
  for (const changed of [
    { ...command, command: 'node other.js' },
    { ...command, cwd: 'another-root' },
    { ...command, shell: 'powershell' },
    { ...command, timeoutMs: 1000 },
    { ...command, criteria: ['foreign'] },
  ])
    expect(reviewedCheckEnvironment(review, changed, current)).toBeUndefined();
  expect(reviewedCheckEnvironment(review, command, {})).toBeUndefined();
  expect(
    reviewedCheckEnvironment({ ...review, dependencies: 'e'.repeat(64) }, command, current),
  ).toBeUndefined();
  const observation = {
    kind: 'browser-observation' as const,
    source: { argsHash: source.argsHash, revision: source.revision, name: source.name },
  };
  expect(reviewedCheckEnvironment(review, observation, current)).toBeDefined();
  expect(
    reviewedCheckEnvironment(
      review,
      { ...observation, source: { ...source, argsHash: 'f'.repeat(64) } },
      current,
    ),
  ).toBeUndefined();
  expect(
    verificationReviewSchema.safeParse({
      ...review,
      assumptions: [...review.assumptions, ...review.assumptions],
    }).success,
  ).toBe(false);
  expect(
    verificationReviewSchema.safeParse({ ...review, commands: [], observations: [] }).success,
  ).toBe(false);
}, 20000);

it('expires browser observations on later browser calls while allowing assessment and submission', () => {
  const source = 'mcp__browser__browser_evaluate';
  expect(sameObservationHost(source, 'mcp__browser__browser_navigate')).toBe(true);
  expect(sameObservationHost(source, source)).toBe(true);
  expect(sameObservationHost(source, 'mcp__skaro__submit_result')).toBe(false);
  expect(sameObservationHost(source, 'mcp__skaro__review_c4')).toBe(false);
  expect(sameObservationHost(source, 'inspect_acceptance')).toBe(false);
  expect(sameObservationHost('not-an-observation', source)).toBe(false);
});
