import type { C4Model } from './model.ts';

export interface C4ModelChange {
  key: string;
  group: string;
  id: string;
  title: string;
  operation: 'add' | 'remove' | 'update';
  fields: string[];
}
export interface C4ModelDetail extends C4ModelChange {
  before: string;
  after: string;
}

/** Object property order is irrelevant; array order is deliberately preserved. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, v]) => [key, stable(v)]),
    );
  return value;
}
const equal = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const serialize = (v: unknown) =>
  v === undefined ? '' : JSON.stringify(stable(v), null, 2) + '\n';

function identity(group: string, value: Record<string, unknown>): string {
  if (group === 'exclusions') return JSON.stringify([value.scope, value.kind, value.state]);
  return String(value.id);
}

/** Compare entities by identity, never by a serialized model's line positions. */
export function c4ModelChanges(before: C4Model | undefined, after: C4Model): C4ModelDetail[] {
  const result: C4ModelDetail[] = [];
  const names = new Map(
    [...(before?.elements ?? []), ...after.elements].map((e) => [e.id, e.name]),
  );
  const add = (group: string, id: string, a: unknown, b: unknown, title: string) => {
    if (equal(a, b)) return;
    const old = (a ?? {}) as Record<string, unknown>,
      next = (b ?? {}) as Record<string, unknown>;
    result.push({
      key: JSON.stringify([group, id]),
      group,
      id,
      title,
      operation: a === undefined ? 'add' : b === undefined ? 'remove' : 'update',
      fields: [...new Set([...Object.keys(old), ...Object.keys(next)])].filter(
        (key) => !equal(old[key], next[key]),
      ),
      before: serialize(a),
      after: serialize(b),
    });
  };
  add(
    'model',
    'metadata',
    before && { version: before.version, title: before.title },
    { version: after.version, title: after.title },
    'C4',
  );
  for (const group of [
    'elements',
    'relationships',
    'views',
    'specifications',
    'exclusions',
    'questions',
    'removals',
  ] as const) {
    const a = (before?.[group] ?? []) as unknown as Record<string, unknown>[];
    const b = (after[group] ?? []) as unknown as Record<string, unknown>[];
    const old = new Map(a.map((v) => [identity(group, v), v]));
    const next = new Map(b.map((v) => [identity(group, v), v]));
    for (const id of new Set([...old.keys(), ...next.keys()])) {
      const value = next.get(id) ?? old.get(id)!;
      const title =
        group === 'relationships'
          ? `${names.get(String(value.source)) ?? value.source} → ${names.get(String(value.target)) ?? value.target}`
          : group === 'exclusions'
            ? `${value.scope} · ${value.kind} · ${value.state}`
            : String(value.name ?? value.title ?? id);
      add(group, id, old.get(id), next.get(id), title);
    }
    const commonA = [...old.keys()].filter((id) => next.has(id));
    const commonB = [...next.keys()].filter((id) => old.has(id));
    if (!equal(commonA, commonB)) add(group, '$order', commonA, commonB, group);
  }
  return result;
}
