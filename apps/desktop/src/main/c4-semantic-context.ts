import { authoredBody, type ProjectArtifacts } from '@skaro/core';
import type { C4TaskScope } from './c4-task-scope';
import { taskSections } from './task-body';
import { memoryVersion } from './project-memory-sources';

/** Host-written completion metadata cannot change the implementation's semantic input. */
export function c4SemanticTaskBody(body: string) {
  const content = body
    .replace(/(^\s*[-*]\s+)\[[ xX]\]/gm, '$1[ ]')
    .replace(/^##\s+(?:Итог|Summary)\s*$[\s\S]*/m, '')
    .trimEnd();
  return content ? content + '\n' : '';
}

/** Local semantic facts include parents and applicable questions, without unrelated siblings. */
export function c4SemanticContext(
  artifacts: Pick<ProjectArtifacts, 'c4' | 'architecture' | 'brief' | 'tasks' | 'specs' | 'adrs'>,
  task: string,
  scope: C4TaskScope,
) {
  const model = artifacts.c4;
  const spec = model?.specifications.find((s) => s.id === scope.spec);
  const requirements = spec?.requirements.filter((r) => scope.requirements.includes(r.id)) ?? [];
  const roots = new Set([...scope.elements, ...requirements.flatMap((r) => r.elements)]);
  const relations =
    model?.relationships.filter(
      (r) => scope.relationships.includes(r.id) || roots.has(r.source) || roots.has(r.target),
    ) ?? [];
  const ids = new Set([...roots, ...relations.flatMap((r) => [r.source, r.target])]);
  for (const id of ids) {
    const parent = model?.elements.find((e) => e.id === id)?.parent;
    if (parent) ids.add(parent);
  }
  const selected = new Set(relations.map((r) => r.id));
  const elements = model?.elements.filter((e) => ids.has(e.id)) ?? [];
  const decisions = new Set(
    [...elements, ...relations].flatMap((e) => [...e.decisions, ...(e.planned?.decisions ?? [])]),
  );
  const document = artifacts.specs.find((s) => s.id === scope.spec);
  const sections = taskSections(artifacts.tasks.find((t) => t.id === task)?.body ?? '');
  return {
    modelPresent: !!model,
    architecture: authoredBody(artifacts.architecture?.body ?? ''),
    brief: artifacts.brief?.body ?? '',
    decisions: artifacts.adrs
      .filter((d) => decisions.has(d.id) || decisions.has(`ADR-${d.id}`))
      .map((d) => ({ id: d.id, status: d.status, body: authoredBody(d.body) })),
    taskBody: c4SemanticTaskBody(artifacts.tasks.find((t) => t.id === task)?.body ?? ''),
    task: { goal: sections.goal, criteria: sections.criteria.map((c) => c.text), spec: scope.spec },
    requirements,
    // Preserve complete authored constraints, including continuations and global spec rules.
    requirementText: authoredBody(document?.body ?? ''),
    elements,
    relationships: relations,
    views:
      model?.views
        .filter(
          (v) =>
            v.elements.some((id) => roots.has(id)) ||
            v.relationships.some((id) => selected.has(id)),
        )
        .map((v) => ({
          ...v,
          elements: v.elements.filter((id) => ids.has(id)),
          relationships: v.relationships.filter((id) => selected.has(id)),
          steps: v.steps.filter((s) => selected.has(s.relationship)),
          instances: v.instances.filter((i) => ids.has(i.element) || ids.has(i.node)),
          instanceRelationships: v.instanceRelationships?.filter((r) =>
            selected.has(r.relationship),
          ),
        })) ?? [],
    questions:
      model?.questions.filter((q) => q.affects.some((id) => ids.has(id) || selected.has(id))) ?? [],
    exclusions: model?.exclusions.filter((e) => ids.has(e.scope)) ?? [],
    removals: model?.removals?.filter((r) => ids.has(r.id) || selected.has(r.id)) ?? [],
  };
}
export const c4SemanticContextHash = (
  value: ReturnType<typeof c4SemanticContext> & {
    preservation?: import('./c4-preservation').C4Preservation;
  },
) => memoryVersion(value);
