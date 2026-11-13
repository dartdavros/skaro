import { isDeepStrictEqual as equal } from 'node:util';
import type { C4Model, C4Package } from './model.ts';
import { C4_MODEL_PATH } from './model.ts';
import { c4Hash } from './documents.ts';
import { readC4File } from './io.ts';
import { readC4Model } from './shape.ts';
import { prepareC4Package } from './package.ts';

type Entity = { id: string };
const conflict = (path: string): never => {
  throw new Error(`C4: overlapping change at ${path}; fresh semantic review is required`);
};
const changed = <T>(before: T, after: T, current: T, path: string): T =>
  equal(before, after)
    ? structuredClone(current)
    : equal(before, current) || equal(after, current)
      ? structuredClone(after)
      : conflict(path);

function records<T extends Entity>(
  before: T[],
  after: T[],
  current: T[],
  path: string,
  merge?: (b: T, a: T, c: T, p: string) => T,
): T[] {
  const original = before.map((v) => v.id),
    proposed = after.filter((v) => original.includes(v.id)).map((v) => v.id);
  if (
    !equal(
      before.filter((v) => after.some((a) => a.id === v.id)).map((v) => v.id),
      proposed,
    )
  )
    conflict(`${path}.$order`);
  const result = new Map(current.map((v) => [v.id, structuredClone(v)]));
  for (const id of new Set([...original, ...after.map((v) => v.id)])) {
    const b = before.find((v) => v.id === id),
      a = after.find((v) => v.id === id),
      c = current.find((v) => v.id === id);
    if (equal(b, a)) continue;
    const value =
      b && a && c && merge ? merge(b, a, c, `${path}.${id}`) : changed(b, a, c, `${path}.${id}`);
    if (value === undefined) result.delete(id);
    else result.set(id, value);
  }
  return [...result.values()];
}
function setRefs(before: string[], after: string[], current: string[]) {
  const removed = new Set(before.filter((id) => !after.includes(id)));
  return [
    ...new Set([
      ...current.filter((id) => !removed.has(id)),
      ...after.filter((id) => !before.includes(id)),
    ]),
  ];
}
function view(b: C4Model['views'][number], a: typeof b, c: typeof b, path: string): typeof b {
  const { elements: be, relationships: br, instances: bi, ...base } = b;
  const { elements: ae, relationships: ar, instances: ai, ...next } = a;
  const { elements: ce, relationships: cr, instances: ci, ...now } = c;
  return {
    ...changed(base, next, now, path),
    elements: setRefs(be, ae, ce),
    relationships: setRefs(br, ar, cr),
    instances: records(bi, ai, ci, `${path}.instances`),
  };
}
function specification(
  b: C4Model['specifications'][number],
  a: typeof b,
  c: typeof b,
  path: string,
): typeof b {
  const { elements: be, relationships: br, views: bv, requirements: bq, ...base } = b;
  const { elements: ae, relationships: ar, views: av, requirements: aq, ...next } = a;
  const { elements: ce, relationships: cr, views: cv, requirements: cq, ...now } = c;
  return {
    ...changed(base, next, now, path),
    elements: setRefs(be, ae, ce),
    relationships: setRefs(br, ar, cr),
    views: setRefs(bv, av, cv),
    requirements: records(bq, aq, cq, `${path}.requirements`),
  };
}

/** Rebuild only disjoint semantic deltas. A revision number alone never legitimizes a stale package. */
export function rebaseC4ImpactModel(before: C4Model, after: C4Model, current: C4Model): C4Model {
  const exclusions = (values: C4Model['exclusions']) =>
    values.map((v) => ({ ...v, id: JSON.stringify([v.kind, v.scope, v.state]) }));
  return {
    version: 1,
    revision: current.revision + 1,
    title: changed(before.title, after.title, current.title, 'title'),
    elements: records(before.elements, after.elements, current.elements, 'elements'),
    relationships: records(
      before.relationships,
      after.relationships,
      current.relationships,
      'relationships',
    ),
    views: records(before.views, after.views, current.views, 'views', view),
    specifications: records(
      before.specifications,
      after.specifications,
      current.specifications,
      'specifications',
      specification,
    ),
    questions: records(before.questions, after.questions, current.questions, 'questions'),
    exclusions: records(
      exclusions(before.exclusions),
      exclusions(after.exclusions),
      exclusions(current.exclusions),
      'exclusions',
    ).map(({ id: _id, ...v }) => v),
    ...([before.removals, after.removals, current.removals].some((v) => v !== undefined)
      ? {
          removals: records(
            before.removals ?? [],
            after.removals ?? [],
            current.removals ?? [],
            'removals',
          ),
        }
      : {}),
  };
}

/** Authored documents keep exact before/after guards; the normal writer revalidates all global invariants. */
export async function prepareRebasedC4Impact(root: string, pkg: C4Package): Promise<C4Package> {
  const entry = pkg.files.find((f) => f.path === C4_MODEL_PATH);
  const raw = await readC4File(root, C4_MODEL_PATH);
  if (entry?.before === null && raw === null && pkg.baseRevision === 0) return pkg;
  if (!entry?.before)
    throw new Error('C4: initial model cannot be rebased over another architecture');
  if (raw === null) throw new Error('C4: accepted model disappeared');
  const current = readC4Model(JSON.parse(raw));
  if (raw === entry.before && current.revision === pkg.baseRevision) return pkg;
  const model = rebaseC4ImpactModel(
    readC4Model(JSON.parse(entry.before)),
    readC4Model(JSON.parse(entry.after)),
    current,
  );
  const documents = [];
  for (const file of pkg.files.filter((f) => f.path !== C4_MODEL_PATH)) {
    const actual = await readC4File(root, file.path);
    if (actual !== file.before && actual !== file.after) conflict(file.path);
    if (actual !== file.after) documents.push({ path: file.path, content: file.after });
  }
  const rebuilt = await prepareC4Package(root, {
    title: pkg.title,
    summary: pkg.summary,
    baseRevision: current.revision,
    model,
    documents,
    locale: '',
    ...(pkg.task ? { task: pkg.task } : {}),
  });
  return {
    ...rebuilt,
    id: c4Hash(
      JSON.stringify([pkg.id, c4Hash(JSON.stringify(pkg)), current.revision, c4Hash(raw)]),
    ),
  };
}
