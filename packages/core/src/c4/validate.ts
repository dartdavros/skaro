import type { C4Element, C4Model } from './model.ts';
import { inspectC4Views } from './validate-views.ts';
import { C4Problems, c4Issue, type C4Issue } from './diagnostics.ts';
import { c4AtState } from './state.ts';

const PARENT: Record<C4Element['kind'], C4Element['kind'][]> = {
  person: [],
  system: [],
  container: ['system'],
  component: ['container'],
  code: ['component', 'code'],
  'deployment-node': ['deployment-node'],
};

export function uniqueIds(
  entries: { id: string }[],
  errors: Pick<C4Problems, 'push'>,
  label: string,
): void {
  const seen = new Set<string>();
  for (const { id } of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) errors.push(`${label}: invalid identifier ${id}`);
    if (seen.has(id)) errors.push(`${label}: duplicate identifier ${id}`);
    seen.add(id);
  }
}

export function ancestors(id: string, elements: Map<string, C4Element>): string[] {
  const path: string[] = [];
  let next: string | undefined = id;
  while (next && !path.includes(next)) {
    path.push(next);
    next = elements.get(next)?.parent;
  }
  return path;
}

/** Structural consistency is executable; factual correctness still requires code evidence. */
export function validateC4Model(model: C4Model, checkViews = true): string[] {
  return inspectC4Model(model, checkViews).map((issue) => issue.message);
}

export function inspectC4Model(model: C4Model, checkViews = true): C4Issue[] {
  const errors = new C4Problems();
  uniqueIds(
    [...model.elements, ...model.relationships, ...model.views, ...model.questions],
    errors,
    'C4',
  );
  const elements = new Map(model.elements.map((e) => [e.id, e]));
  if (!model.elements.some((e) => e.kind === 'system' && !e.external))
    errors.push('C4: at least one owned system is required');
  for (const element of model.elements) {
    const allowed = PARENT[element.kind];
    if (element.planned && element.state !== 'current')
      errors.push(`${element.id}: only current elements can have a planned revision`);
    const parent = element.parent ? elements.get(element.parent) : undefined;
    if (
      (element.parent && (!parent || !allowed.includes(parent.kind))) ||
      (!element.parent && allowed.length && element.kind !== 'deployment-node')
    )
      errors.push(`${element.id}: invalid or missing parent`);
    if (element.parent && ancestors(element.parent, elements).includes(element.id))
      errors.push(`${element.id}: cyclic hierarchy`);
    if (element.state === 'current' && parent?.state === 'planned')
      errors.add(
        c4Issue(
          `${element.id}: current element inside planned parent`,
          'planned_parent',
          [element.id, parent.id],
          'Verify the parent implementation. Include its ID in review_c4.realized only if fully implemented and verified; otherwise keep the child planned. Never promote an unimplemented parent.',
        ),
      );
    if (
      ['container', 'component', 'code', 'deployment-node'].includes(element.kind) &&
      !element.technology
    )
      errors.push(`${element.id}: technology is required`);
    if (!element.evidence.length) errors.push(`${element.id}: source evidence is required`);
    if (element.kind === 'code' && element.state === 'current' && !element.code.length)
      errors.push(`${element.id}: current code element needs a code path`);
  }
  for (const relation of model.relationships) {
    if (relation.planned && relation.state !== 'current')
      errors.push(`${relation.id}: only current relationships can have a planned revision`);
    const source = elements.get(relation.source),
      target = elements.get(relation.target);
    if (!source || !target) errors.push(`${relation.id}: unknown relationship endpoint`);
    if (relation.source === relation.target) errors.push(`${relation.id}: self relationship`);
    if (relation.state === 'current' && [source, target].some((e) => e?.state === 'planned'))
      errors.push(`${relation.id}: current relationship has a planned endpoint`);
    if (!relation.evidence.length) errors.push(`${relation.id}: source evidence is required`);
  }
  const all = new Set([...model.elements, ...model.relationships, ...model.views].map((e) => e.id));
  const removals = new Set<string>();
  for (const removal of model.removals ?? []) {
    if (
      removals.has(removal.id) ||
      ![...model.elements, ...model.relationships].some((e) => e.id === removal.id)
    )
      errors.push(`${removal.id}: duplicate or unknown planned removal`);
    removals.add(removal.id);
  }
  for (const question of model.questions) {
    if (!question.affects.length) errors.push(`${question.id}: affected identifiers required`);
    for (const id of question.affects)
      if (!all.has(id)) errors.push(`${question.id}: unknown affected ${id}`);
  }
  if (checkViews) inspectC4Views(model, errors);
  if (
    model.elements.some((e) => e.planned) ||
    model.relationships.some((r) => r.planned) ||
    model.removals?.length
  ) {
    const planned = c4AtState(model, 'planned');
    const plannedErrors = inspectC4Model(planned, false);
    for (const issue of plannedErrors)
      errors.add({ ...issue, message: `planned: ${issue.message}` });
  }
  return errors.issues;
}
