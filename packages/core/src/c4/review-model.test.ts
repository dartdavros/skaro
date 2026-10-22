import { expect, it } from 'vitest';
import { skaroC4 } from '../../../../docs/c4/skaro-model.ts';
import { c4ModelChanges } from './review-model.ts';

it('compares documented Skaro objects by identity and preserves meaningful order changes', () => {
  const after = structuredClone(skaroC4);
  after.revision++;
  after.elements.reverse();
  after.relationships[0]!.description += ' ';
  const scenario = after.views.find((v) => v.kind === 'dynamic' && v.steps.length > 1)!;
  scenario.steps.reverse();
  const changes = c4ModelChanges(skaroC4, after);
  expect(changes.filter((c) => c.group === 'elements')).toMatchObject([
    { id: '$order', operation: 'update' },
  ]);
  expect(changes.find((c) => c.id === after.relationships[0]!.id)?.fields).toEqual(['description']);
  expect(changes.find((c) => c.id === scenario.id)?.fields).toEqual(['steps']);
  expect(changes.some((c) => c.operation === 'remove' || c.operation === 'add')).toBe(false);
});

it('ignores serialization order and revision bookkeeping, but reports actual removal', () => {
  const reordered = JSON.parse(JSON.stringify(skaroC4), (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value))
      return Object.fromEntries(Object.entries(value).reverse());
    return value;
  }) as typeof skaroC4;
  reordered.revision++;
  expect(c4ModelChanges(skaroC4, reordered)).toEqual([]);
  const removed = reordered.relationships.pop()!;
  expect(c4ModelChanges(skaroC4, reordered)).toMatchObject([
    { group: 'relationships', id: removed.id, operation: 'remove', after: '' },
  ]);
});
