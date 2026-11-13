import { expect, it } from 'vitest';
import { observedEnvironmentObjectIds } from './environment-resource-observation';

// Observation/ownership DTO semantics only; no fake Docker client or project.
it('retains the last known identities on unavailable evidence and clears only after a successful empty observation', () => {
  const previous = ['last-verified-object'];
  expect(observedEnvironmentObjectIds(undefined, 'permanent-source', previous)).toEqual(previous);
  expect(observedEnvironmentObjectIds([], 'permanent-source', previous)).toEqual([]);
  expect(previous).toEqual(['last-verified-object']);
});
