import { c4Issue, type C4Model, type C4Issue } from '@skaro/core';

/** A partial child result cannot promote a declared, still incomplete parent. */
export function c4RealizationScopeProblems(
  model: C4Model | undefined,
  realized: string[],
): C4Issue[] {
  if (!model || !realized.length) return [];
  const selected = new Set(realized),
    issues: C4Issue[] = [];
  for (const parent of model.elements.filter((e) => selected.has(e.id))) {
    const children = new Set([parent.id]);
    for (const id of children)
      for (const child of model.elements.filter((e) => e.parent === id)) children.add(child.id);
    const incomplete = model.elements.filter(
      (e) =>
        e.id !== parent.id &&
        children.has(e.id) &&
        (e.state === 'planned' || e.planned) &&
        !selected.has(e.id),
    );
    if (incomplete.length)
      issues.push(
        c4Issue(
          `${parent.id}: planned descendants remain unverified: ${incomplete.map((e) => e.id).join(', ')}`,
          'planned_parent',
          [parent.id, ...incomplete.map((e) => e.id)],
        ),
      );
  }
  return issues;
}
