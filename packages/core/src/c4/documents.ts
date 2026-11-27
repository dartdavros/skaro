import { createHash } from 'node:crypto';
import { parseMarkdown, getFields } from '../artifacts/frontmatter.ts';
import type { C4Model } from './model.ts';
import { authoredBody } from './render.ts';

export const c4Hash = (body: string): string => createHash('sha256').update(body).digest('hex');
export const c4BodyHash = (text: string): string =>
  c4Hash(authoredBody(parseMarkdown(text).body.replace(/\r\n/g, '\n')));

export function matchesC4BodyHash(text: string, expected: string): boolean {
  const body = parseMarkdown(text).body;
  const lf = body.replace(/\r\n/g, '\n');
  if (c4Hash(authoredBody(lf)) === expected) return true;
  // Previously accepted models may store a hash of the original Windows line endings.
  return (
    (body !== lf && c4Hash(authoredBody(body)) === expected) ||
    c4Hash(authoredBody(lf.replace(/\n/g, '\r\n'))) === expected
  );
}
export const C4_DOCUMENT_PATH =
  /^(architecture\.md|brief\.md|docs\/[a-zA-Z0-9_-]+\.md|(adr|specs)\/\d{4}-[a-zA-Z0-9_-]+\.md)$/;

export function validateC4Documents(model: C4Model, documents: Map<string, string>): string[] {
  const errors: string[] = [];
  const ids = { adr: new Set<string>(), specs: new Set<string>() };
  const acceptedAdrs = new Set<string>();
  for (const [path, text] of documents) {
    const match = /^(adr|specs)\/(\d{4})-/.exec(path);
    if (!match) continue;
    const group = match[1] as 'adr' | 'specs',
      id = match[2]!;
    const { body, ...file } = parseMarkdown(text);
    const fields = getFields({ ...file, body });
    if (
      fields.id !== id ||
      typeof fields.title !== 'string' ||
      !fields.title.trim() ||
      !['accepted', 'proposed', 'superseded'].includes(String(fields.status))
    )
      errors.push(`${path}: frontmatter requires matching string id, title and valid status`);
    if (ids[group].has(id)) errors.push(`${path}: duplicate ${group} number ${id}`);
    ids[group].add(id);
    if (group === 'adr' && fields.status === 'accepted') acceptedAdrs.add(id);
    if (
      group === 'specs' &&
      fields.status === 'accepted' &&
      !model.specifications.some((s) => s.id === id && s.path === path)
    )
      errors.push(`${path}: accepted specification has no C4 binding`);
  }
  const elements = new Set(model.elements.map((e) => e.id));
  const relationships = new Set(model.relationships.map((r) => r.id));
  const views = new Set(model.views.map((v) => v.id));
  const specIds = new Set<string>();
  for (const spec of model.specifications) {
    if (!/^\d{4}$/.test(spec.id)) {
      errors.push(`Invalid specification number ${spec.id}`);
      continue;
    }
    if (specIds.has(spec.id)) errors.push(`SPEC-${spec.id}: duplicate binding`);
    specIds.add(spec.id);
    const text = documents.get(spec.path);
    if (!text || !new RegExp(`^specs/${spec.id}-[a-zA-Z0-9_-]+\\.md$`).test(spec.path)) {
      errors.push(`SPEC-${spec.id}: missing or invalid document path`);
      continue;
    }
    if (!matchesC4BodyHash(text, spec.bodyHash))
      errors.push(`SPEC-${spec.id}: C4 binding is stale after document edits`);
    const checkRefs = (
      entry: { elements: string[]; relationships: string[]; views: string[] },
      label: string,
    ) => {
      for (const [field, known] of [
        ['elements', elements],
        ['relationships', relationships],
        ['views', views],
      ] as const)
        for (const id of entry[field])
          if (!known.has(id)) errors.push(`${label}: unknown ${field} ${id}`);
    };
    checkRefs(spec, `SPEC-${spec.id}`);
    if (!spec.elements.length || !spec.views.length)
      errors.push(`SPEC-${spec.id}: architectural elements and views required`);
    const requirements = [
      ...new Set(authoredBody(parseMarkdown(text).body).match(/\bR-\d+\b/g) ?? []),
    ];
    if (!requirements.length) errors.push(`SPEC-${spec.id}: numbered requirements R-n required`);
    const mapped = new Set<string>();
    for (const requirement of spec.requirements) {
      if (mapped.has(requirement.id))
        errors.push(`SPEC-${spec.id}: duplicate requirement ${requirement.id}`);
      mapped.add(requirement.id);
      if (!requirements.includes(requirement.id))
        errors.push(`SPEC-${spec.id}: unknown requirement ${requirement.id}`);
      if (!requirement.elements.length || !requirement.views.length)
        errors.push(`SPEC-${spec.id}/${requirement.id}: empty architecture coverage`);
      checkRefs(requirement, `SPEC-${spec.id}/${requirement.id}`);
      for (const field of ['elements', 'relationships'] as const)
        for (const id of requirement[field])
          if (
            !requirement.views.some((v) =>
              model.views.find((view) => view.id === v)?.[field].includes(id),
            )
          )
            errors.push(
              `SPEC-${spec.id}/${requirement.id}: ${id} is absent from requirement views`,
            );
      for (const field of ['elements', 'relationships', 'views'] as const)
        for (const id of requirement[field])
          if (!spec[field].includes(id))
            errors.push(`SPEC-${spec.id}/${requirement.id}: ${id} outside specification coverage`);
    }
    for (const id of requirements)
      if (!mapped.has(id)) errors.push(`SPEC-${spec.id}: unmapped requirement ${id}`);
    for (const id of spec.elements)
      if (!spec.views.some((v) => model.views.find((view) => view.id === v)?.elements.includes(id)))
        errors.push(`SPEC-${spec.id}: ${id} is absent from its views`);
    for (const id of spec.relationships)
      if (
        !spec.views.some((v) =>
          model.views.find((view) => view.id === v)?.relationships.includes(id),
        )
      )
        errors.push(`SPEC-${spec.id}: ${id} is absent from its views`);
    if (
      spec.relationships.length &&
      !spec.views.some((id) => model.views.find((v) => v.id === id)?.kind === 'dynamic')
    )
      errors.push(`SPEC-${spec.id}: interactions require a dynamic view`);
  }
  for (const entity of [...model.elements, ...model.relationships])
    for (const id of [...entity.decisions, ...(entity.planned?.decisions ?? [])])
      if (!ids.adr.has(id)) errors.push(`${entity.id}: unknown ADR-${id}`);
      else if (!acceptedAdrs.has(id))
        errors.push(`${entity.id}: governing ADR-${id} must be accepted`);
  return errors;
}
