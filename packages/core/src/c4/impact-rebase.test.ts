import { expect, it } from 'vitest';
import { skaroC4 } from '../../../../docs/c4/skaro-model.ts';
import { rebaseC4ImpactModel } from './impact-rebase.ts';

it('rebases independent documented objects while preserving the concurrent model, without mutation', () => {
  const before = structuredClone(skaroC4),
    after = structuredClone(before),
    current = structuredClone(before);
  after.revision++;
  after.elements[0]!.description += ' Reviewed change A.';
  current.revision++;
  current.elements.at(-1)!.description += ' Independent change B.';
  const original = structuredClone(current),
    next = rebaseC4ImpactModel(before, after, current);
  expect(next.revision).toBe(current.revision + 1);
  expect(next.elements[0]).toEqual(after.elements[0]);
  expect(next.elements.at(-1)).toEqual(current.elements.at(-1));
  expect(current).toEqual(original);
  expect(before).toEqual(skaroC4);
});
it('refuses overlap and changed meaningful order instead of relabelling a stale revision', () => {
  const before = structuredClone(skaroC4),
    after = structuredClone(before),
    current = structuredClone(before);
  after.elements[0]!.description += ' A';
  current.elements[0]!.description += ' B';
  expect(() => rebaseC4ImpactModel(before, after, current)).toThrow('overlapping change');
  const reordered = structuredClone(before);
  reordered.elements.reverse();
  expect(() => rebaseC4ImpactModel(before, reordered, current)).toThrow('$order');
});
