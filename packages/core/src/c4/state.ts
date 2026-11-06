import { C4ValidationError, c4Issue } from './diagnostics.ts';
import type { C4Model, C4State } from './model.ts';

/** View state selects descriptions as well as membership; planned edits never replace current facts. */
export function c4AtState(model: C4Model, state: C4State): C4Model {
  if (state === 'current') return model;
  const removed = new Set(model.removals?.map((r) => r.id) ?? []);
  return {
    ...model,
    elements: model.elements
      .filter((e) => !removed.has(e.id))
      .map((e) => (e.planned ? { ...e, ...e.planned, planned: undefined } : e)),
    relationships: model.relationships
      .filter((r) => !removed.has(r.id))
      .map((r) => (r.planned ? { ...r, ...r.planned, planned: undefined } : r)),
    removals: [],
  };
}

/** Publication realizes only the IDs the implementing agent explicitly verified. */
export function realizeC4(model: C4Model, ids: string[]): C4Model {
  const result = structuredClone(model);
  const removed = new Set(
    result.removals?.filter((r) => ids.includes(r.id)).map((r) => r.id) ?? [],
  );
  for (const spec of result.specifications)
    if (
      [
        ...spec.elements,
        ...spec.relationships,
        ...spec.requirements.flatMap((r) => [...r.elements, ...r.relationships]),
      ].some((id) => removed.has(id))
    )
      throw new C4ValidationError(
        [
          c4Issue(
            `SPEC-${spec.id}: rebind requirements before publishing removal of referenced C4 elements`,
          ),
        ],
        'publication',
      );
  result.elements = result.elements.filter((e) => !removed.has(e.id));
  result.relationships = result.relationships.filter((r) => !removed.has(r.id));
  result.removals = result.removals?.filter((r) => !removed.has(r.id));
  for (const view of result.views) {
    view.elements = view.elements.filter((id) => !removed.has(id));
    view.relationships = view.relationships.filter((id) => !removed.has(id));
    view.steps = view.steps.filter((s) => !removed.has(s.relationship));
    view.instances = view.instances.filter((i) => !removed.has(i.element) && !removed.has(i.node));
    view.instanceRelationships = view.instanceRelationships?.filter(
      (link) =>
        !removed.has(link.relationship) &&
        [link.source, link.target].every(
          (id) => view.instances.some((i) => i.id === id) || view.elements.includes(id),
        ),
    );
  }
  result.views = result.views.filter((v) => !removed.has(v.scope));
  result.exclusions = result.exclusions.filter((e) => !removed.has(e.scope));
  for (const element of result.elements) {
    if (!ids.includes(element.id)) continue;
    if (element.planned) Object.assign(element, element.planned);
    delete element.planned;
    element.state = 'current';
  }
  for (const relation of result.relationships) {
    if (!ids.includes(relation.id)) continue;
    const candidate = relation.planned ? { ...relation, ...relation.planned } : relation;
    if (
      result.elements.find((e) => e.id === candidate.source)?.state !== 'current' ||
      result.elements.find((e) => e.id === candidate.target)?.state !== 'current'
    )
      throw new C4ValidationError(
        [
          c4Issue(
            `${relation.id}: cannot publish a current relationship before its endpoints`,
            'planned_parent',
            [relation.id, candidate.source, candidate.target],
            'Review the relationship endpoints. Publish only implemented, verified endpoint IDs together with the relationship, or keep the relationship planned.',
          ),
        ],
        'publication',
      );
    Object.assign(relation, candidate);
    delete relation.planned;
    relation.state = 'current';
  }
  for (const view of result.views.filter((v) => v.state === 'planned')) {
    if (
      view.elements.every((id) => {
        const e = result.elements.find((e) => e.id === id);
        return e?.state === 'current' && !e.planned;
      }) &&
      view.relationships.every((id) => {
        const r = result.relationships.find((r) => r.id === id);
        return r?.state === 'current' && !r.planned;
      })
    )
      view.state = 'current';
  }
  for (const exclusion of result.exclusions) {
    const element = result.elements.find((e) => e.id === exclusion.scope);
    if (ids.includes(exclusion.scope) && element?.state === 'current' && !element.planned)
      exclusion.state = 'current';
  }
  // Current and planned views may converge; an exclusion cannot coexist with the realized view.
  result.exclusions = result.exclusions.filter(
    (e, index, all) =>
      !result.views.some((v) => v.scope === e.scope && v.kind === e.kind && v.state === e.state) &&
      all.findIndex(
        (other) => other.scope === e.scope && other.kind === e.kind && other.state === e.state,
      ) === index,
  );
  return result;
}
