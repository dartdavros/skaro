import { expect, it } from 'vitest';
import { realizeC4 } from '@skaro/core';
import { skaroC4 } from '../../../../docs/c4/skaro-model';
import { c4RealizationScopeProblems } from './c4-realization-scope';

/** Pure state-transition counterfactual on documented repository metadata, no files or project seeded. */
it('refuses parent promotion over a planned child and never promotes the parent for a child-only result', () => {
  const model = structuredClone(skaroC4);
  const parent = model.elements.find((e) => e.id === 'c4service')!;
  const child = model.elements.find((e) => e.id === 'serviceclass')!;
  parent.state = 'planned';
  child.state = 'planned';
  expect(c4RealizationScopeProblems(model, [parent.id])).toHaveLength(1);
  expect(c4RealizationScopeProblems(model, [parent.id, child.id])).toEqual([]);
  const result = realizeC4(model, [child.id]);
  expect(result.elements.find((e) => e.id === parent.id)?.state).toBe('planned');
  expect(model.elements.find((e) => e.id === child.id)?.state).toBe('planned');
  expect(skaroC4.elements.find((e) => e.id === parent.id)?.state).toBe('current');
});
