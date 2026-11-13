import { expect, it } from 'vitest';
import { c4SemanticFingerprint, parseC4SemanticVerdict } from './c4-semantic-result';
import { semanticTestObservation } from './c4-semantic-test-input';

it('binds independent semantics to actual source hashes and rejects incomplete or foreign evidence', async () => {
  const observation = await semanticTestObservation();
  const fingerprint = c4SemanticFingerprint(observation, observation.architectureHash);
  const verdict = {
    version: 1,
    fingerprint,
    implementation: 'aligned',
    category: 'aligned',
    summary: 'Protocol validation of the observed repository source',
    realized: [],
    evidence: observation.files.map((f) => ({ ...f, detail: 'Actual host-read source bytes' })),
    conflicts: [],
  };
  const parse = (patch = {}) =>
    parseC4SemanticVerdict(JSON.stringify({ ...verdict, ...patch }), fingerprint, observation);
  expect(parse().category).toBe('aligned');
  expect(parse({ category: 'optional' }).implementation).toBe('aligned');
  expect(parse({ category: 'decision', implementation: 'unknown', evidence: [] }).category).toBe(
    'decision',
  );
  expect(() => parse({ fingerprint: 'foreign' })).toThrow();
  expect(() => parse({ evidence: [] })).toThrow();
  expect(() => parse({ evidence: [{ ...verdict.evidence[0], hash: 'changed' }] })).toThrow();
  expect(() => parse({ realized: ['unreviewed-parent'] })).toThrow();
  expect(() => parse({ category: 'optional', implementation: 'conflicting' })).toThrow();
  expect(() => parse({ category: 'contradiction', implementation: 'conflicting' })).toThrow();
  expect(() =>
    parse({
      conflicts: [
        {
          requirement: 'foreign',
          source: observation.files[0]!.path,
          detail: 'No scope authority',
        },
      ],
    }),
  ).toThrow();
});

it('keeps facts across unrelated revisions and commits but invalidates changed sources, scope and authority', async () => {
  const observation = await semanticTestObservation(),
    context = observation.architectureHash;
  const fingerprint = c4SemanticFingerprint(observation, context);
  const moved = structuredClone(observation);
  moved.impact.expectedRevision++;
  moved.head = 'committed-representation';
  moved.runHash = 'host-run-metadata';
  moved.inputs.version = 'checkbox-update';
  expect(c4SemanticFingerprint(moved, context)).toBe(fingerprint);
  for (const change of [
    (v: typeof moved) => {
      v.files[0]!.hash = 'changed';
    },
    (v: typeof moved) => {
      v.scope.elements.push('parent');
    },
    (v: typeof moved) => {
      v.inputs.authority = 'revised';
    },
    (v: typeof moved) => {
      v.resource.generation++;
    },
  ]) {
    const changed = structuredClone(moved);
    change(changed);
    expect(c4SemanticFingerprint(changed, context)).not.toBe(fingerprint);
  }
  expect(c4SemanticFingerprint(moved, 'changed semantic contract')).not.toBe(fingerprint);
});
