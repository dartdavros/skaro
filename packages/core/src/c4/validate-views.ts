import type { C4Model, C4ViewKind } from './model.ts';
import { ancestors, uniqueIds } from './validate.ts';
import { c4AtState } from './state.ts';
import { C4Problems, c4Issue, type C4Issue } from './diagnostics.ts';

/** A leaf relationship may be projected onto an ancestor shown at a coarser level. */
export function projectedEndpoint(
  model: C4Model,
  viewElements: string[],
  id: string,
): string | undefined {
  return ancestors(id, new Map(model.elements.map((e) => [e.id, e]))).find((candidate) =>
    viewElements.includes(candidate),
  );
}

export function validateViews(model: C4Model, errors: string[]): void {
  errors.push(...inspectC4Views(model).map((issue) => issue.message));
}

export function inspectC4Views(model: C4Model, errors = new C4Problems()): C4Issue[] {
  const elements = new Map(model.elements.map((e) => [e.id, e]));
  const scopeKinds = {
    context: ['system'],
    container: ['system'],
    component: ['container'],
    code: ['component'],
    dynamic: ['system', 'container', 'component'],
    deployment: ['system'],
  };
  const kinds = {
    context: ['person', 'system'],
    container: ['person', 'system', 'container'],
    component: ['person', 'system', 'container', 'component'],
    code: ['code'],
    dynamic: ['person', 'system', 'container', 'component', 'code'],
    deployment: ['container', 'deployment-node'],
  };
  for (const view of model.views) {
    const viewModel = c4AtState(model, view.state);
    const viewElements = new Map(viewModel.elements.map((e) => [e.id, e]));
    const viewRelations = new Map(viewModel.relationships.map((r) => [r.id, r]));
    const scope = elements.get(view.scope);
    if (!scope || !scopeKinds[view.kind].includes(scope.kind))
      errors.push(`${view.id}: invalid view scope`);
    if (view.state === 'current' && scope?.state === 'planned')
      errors.add(
        c4Issue(
          `${view.id}: a current view cannot have a planned scope`,
          'planned_view_member',
          [view.id, view.scope],
          PLANNED_VIEW_STEP,
        ),
      );
    if (!view.elements.length) errors.push(`${view.id}: empty view`);
    if (
      new Set(view.elements).size !== view.elements.length ||
      new Set(view.relationships).size !== view.relationships.length
    )
      errors.push(`${view.id}: repeated element or relationship`);
    for (const id of view.elements) {
      const element = viewElements.get(id);
      if (!element || !kinds[view.kind].includes(element.kind))
        errors.push(`${view.id}: invalid element ${id}`);
      if (view.state === 'current' && element?.state === 'planned')
        errors.add(
          c4Issue(
            `${view.id}: current view includes planned ${id}`,
            'planned_view_member',
            [view.id, id],
            PLANNED_VIEW_STEP,
          ),
        );
      const detailKind = { container: 'container', component: 'component', code: 'code' }[
        view.kind as string
      ];
      if (element?.kind === detailKind && !ancestors(id, viewElements).includes(view.scope))
        errors.push(`${view.id}: ${id} is outside scope ${view.scope}`);
    }
    for (const id of view.relationships) {
      const rel = viewRelations.get(id);
      if (!rel) {
        errors.push(`${view.id}: unknown relationship ${id}`);
        continue;
      }
      if (view.state === 'current' && rel.state === 'planned')
        errors.add(
          c4Issue(
            `${view.id}: current view includes planned ${id}`,
            'planned_view_member',
            [view.id, id],
            PLANNED_VIEW_STEP,
          ),
        );
      const from = projectedEndpoint(viewModel, view.elements, rel.source);
      const to = projectedEndpoint(viewModel, view.elements, rel.target);
      if (!from || !to || from === to)
        errors.push(`${view.id}: relationship ${id} has no distinct visible endpoints`);
    }
    if (view.kind === 'dynamic') {
      if (!view.steps.length) errors.push(`${view.id}: dynamic view needs ordered interactions`);
      for (const step of view.steps)
        if (!view.relationships.includes(step.relationship))
          errors.push(`${view.id}: step references absent relationship ${step.relationship}`);
      for (const id of view.relationships)
        if (!view.steps.some((s) => s.relationship === id))
          errors.push(`${view.id}: relationship ${id} has no ordered interaction`);
    } else if (view.steps.length) errors.push(`${view.id}: only dynamic views have steps`);
    if (view.kind === 'deployment') {
      uniqueIds(view.instances, errors, view.id);
      if (!view.instances.length) errors.push(`${view.id}: deployment instances required`);
      for (const instance of view.instances) {
        if (elements.has(instance.id))
          errors.push(`${view.id}: instance identifier collides with element ${instance.id}`);
        if (
          viewElements.get(instance.element)?.kind !== 'container' ||
          viewElements.get(instance.node)?.kind !== 'deployment-node' ||
          !view.elements.includes(instance.element) ||
          !view.elements.includes(instance.node) ||
          !ancestors(instance.element, viewElements).includes(view.scope)
        )
          errors.push(`${view.id}: invalid deployment instance ${instance.id}`);
      }
      for (const id of view.elements.filter((id) => elements.get(id)?.kind === 'container'))
        if (!view.instances.some((i) => i.element === id))
          errors.push(`${view.id}: ${id} has no deployment instance`);
      const pairs = new Set<string>();
      for (const link of view.instanceRelationships ?? []) {
        const key = `${link.relationship}:${link.source}:${link.target}`;
        const rel = viewRelations.get(link.relationship);
        const semantic = (id: string) =>
          view.instances.find((i) => i.id === id)?.element ??
          (view.elements.includes(id) && viewElements.get(id)?.kind === 'deployment-node'
            ? id
            : undefined);
        if (
          pairs.has(key) ||
          !rel ||
          !view.relationships.includes(link.relationship) ||
          semantic(link.source) !== projectedEndpoint(viewModel, view.elements, rel.source) ||
          semantic(link.target) !== projectedEndpoint(viewModel, view.elements, rel.target)
        )
          errors.push(`${view.id}: invalid or duplicate instance relationship ${key}`);
        pairs.add(key);
      }
      for (const id of view.relationships) {
        const rel = viewRelations.get(id);
        if (!rel) continue;
        const source = projectedEndpoint(viewModel, view.elements, rel.source),
          target = projectedEndpoint(viewModel, view.elements, rel.target);
        if (
          [source, target].some(
            (endpoint) => view.instances.filter((i) => i.element === endpoint).length > 1,
          ) &&
          !view.instanceRelationships?.some((link) => link.relationship === id)
        )
          errors.push(`${view.id}: ${id} requires explicit instance topology`);
      }
    } else if (view.instances.length)
      errors.push(`${view.id}: only deployment views have instances`);
    if (view.kind !== 'deployment' && view.instanceRelationships?.length)
      errors.push(`${view.id}: only deployment views have instance relationships`);
  }
  const required: { kind: C4ViewKind; scope: string; state: 'current' | 'planned' }[] = [];
  for (const element of model.elements.filter((e) => !e.external)) {
    const types: C4ViewKind[] =
      element.kind === 'system'
        ? ['context', 'container', 'deployment']
        : element.kind === 'container'
          ? ['component']
          : element.kind === 'component'
            ? ['code']
            : [];
    for (const kind of types) required.push({ kind, scope: element.id, state: element.state });
  }
  for (const need of required) {
    const present = model.views.some(
      (v) => v.kind === need.kind && v.scope === need.scope && v.state === need.state,
    );
    const exclusion = model.exclusions.find(
      (v) => v.kind === need.kind && v.scope === need.scope && v.state === need.state,
    );
    if (!present && !exclusion)
      errors.add(
        c4Issue(
          `${need.scope}: missing ${need.state} ${need.kind} view or evidenced applicability decision`,
          need.state === 'current' ? 'missing_current_view' : 'invalid_data',
          [need.scope],
          need.state === 'current'
            ? 'Inspect the existing planned views. If they include future work, propose a separate planned view containing only the implemented and verified subset, with a valid scope. realizeC4 automatically promotes it when all its members are current. Keep broader future views planned. Use an applicability exclusion only when evidenced and actually applicable.'
            : undefined,
        ),
      );
    if (present && exclusion)
      errors.push(`${need.scope}: ${need.kind} view contradicts its exclusion`);
  }
  const exclusions = new Set<string>();
  for (const exclusion of model.exclusions) {
    const key = `${exclusion.scope}:${exclusion.kind}:${exclusion.state}`;
    if (exclusions.has(key)) errors.push(`duplicate exclusion ${key}`);
    exclusions.add(key);
    if (!elements.has(exclusion.scope)) errors.push(`${key}: unknown exclusion scope`);
    else if (!scopeKinds[exclusion.kind].includes(elements.get(exclusion.scope)!.kind))
      errors.push(`${key}: invalid exclusion scope`);
  }
  return errors.issues;
}

const PLANNED_VIEW_STEP =
  'Keep views over planned scope or members planned before publication. For partial implementation, propose a narrow planned view of only the verified subset; publication automatically promotes eligible views. Do not mark future members current to satisfy a view.';
