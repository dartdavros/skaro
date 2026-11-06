import { C4ValidationError, c4Issue } from './diagnostics.ts';
import type { C4Model } from './model.ts';

type Shape =
  | 'text'
  | 'string'
  | 'boolean'
  | 'integer'
  | readonly string[]
  | { [key: string]: Shape }
  | { list: Shape };
const refs = { list: 'text' } as const;
const state = ['current', 'planned'] as const;
const viewKind = ['context', 'container', 'component', 'code', 'dynamic', 'deployment'] as const;
const requirement = { id: 'text', elements: refs, relationships: refs, views: refs } as const;
const schema: Shape = {
  version: 'integer',
  revision: 'integer',
  title: 'text',
  elements: {
    list: {
      id: 'text',
      kind: ['person', 'system', 'container', 'component', 'code', 'deployment-node'],
      name: 'text',
      description: 'text',
      state,
      external: 'boolean',
      'parent?': 'text',
      'technology?': 'text',
      code: refs,
      evidence: refs,
      decisions: refs,
      'planned?': {
        name: 'text',
        description: 'text',
        'technology?': 'text',
        'parent?': 'text',
        code: refs,
        evidence: refs,
        decisions: refs,
      },
    },
  },
  relationships: {
    list: {
      id: 'text',
      source: 'text',
      target: 'text',
      description: 'text',
      technology: 'text',
      state,
      evidence: refs,
      decisions: refs,
      'planned?': {
        source: 'text',
        target: 'text',
        description: 'text',
        technology: 'text',
        evidence: refs,
        decisions: refs,
      },
    },
  },
  views: {
    list: {
      id: 'text',
      kind: viewKind,
      title: 'text',
      scope: 'text',
      state,
      elements: refs,
      relationships: refs,
      steps: { list: { relationship: 'text', description: 'text' } },
      instances: { list: { id: 'text', element: 'text', node: 'text' } },
      'instanceRelationships?': { list: { relationship: 'text', source: 'text', target: 'text' } },
    },
  },
  specifications: {
    list: {
      id: 'text',
      path: 'text',
      bodyHash: 'text',
      impact: ['changes', 'uses'],
      description: 'text',
      elements: refs,
      relationships: refs,
      views: refs,
      requirements: { list: requirement },
    },
  },
  exclusions: { list: { kind: viewKind, scope: 'text', state, reason: 'text', evidence: 'text' } },
  questions: { list: { id: 'text', question: 'text', affects: refs } },
  'removals?': { list: { id: 'text', reason: 'text', evidence: 'text' } },
};

/** Shared runtime boundary: reject unknown fields and malformed persisted/tool data. */
function inspect(value: unknown, shape: Shape, path: string, errors: string[]): void {
  const fail = (message: string) => {
    errors.push(`${path}: ${message}`);
  };
  if (typeof shape === 'string') {
    if (shape === 'integer') {
      if (!Number.isSafeInteger(value) || Number(value) < 0) fail('expected non-negative integer');
    } else if (shape === 'boolean') {
      if (typeof value !== 'boolean') fail('expected boolean');
    } else if (typeof value !== 'string' || (shape === 'text' && !value.trim())) {
      fail('expected non-empty string');
    }
    return;
  }
  if (Array.isArray(shape)) {
    if (!shape.includes(value as string)) fail(`expected ${shape.join(' | ')}`);
    return;
  }
  if ('list' in shape) {
    if (!Array.isArray(value)) return fail('expected array');
    value.forEach((entry, i) => inspect(entry, shape.list as Shape, `${path}[${i}]`, errors));
    return;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('expected object');
  const object = value as Record<string, unknown>;
  const fields = shape as Record<string, Shape>;
  const known = new Set(Object.keys(fields).map((key) => key.replace(/\?$/, '')));
  for (const key of Object.keys(object)) if (!known.has(key)) fail(`unknown field ${key}`);
  for (const [field, entry] of Object.entries(fields)) {
    const key = field.replace(/\?$/, '');
    if (field.endsWith('?') && object[key] === undefined) continue;
    inspect(object[key], entry, `${path}.${key}`, errors);
  }
}

export function readC4Model(value: unknown): C4Model {
  const errors: string[] = [];
  inspect(value, schema, 'C4', errors);
  if (errors.length) throw new C4ValidationError(errors.map((message) => c4Issue(message)));
  const model = value as C4Model;
  if (model.version !== 1) throw new C4ValidationError([c4Issue('C4: unsupported model version')]);
  return model;
}

/** Publish the exact same schema to agents that the persistence boundary enforces. */
function jsonSchema(shape: Shape): Record<string, unknown> {
  if (typeof shape === 'string')
    return shape === 'integer'
      ? { type: 'integer', minimum: 0 }
      : shape === 'boolean'
        ? { type: 'boolean' }
        : { type: 'string', ...(shape === 'text' ? { minLength: 1 } : {}) };
  if (Array.isArray(shape)) return { type: 'string', enum: shape };
  if ('list' in shape) return { type: 'array', items: jsonSchema(shape.list as Shape) };
  const fields = Object.entries(shape);
  return {
    type: 'object',
    properties: Object.fromEntries(
      fields.map(([k, s]) => [k.replace(/\?$/, ''), jsonSchema(s as Shape)]),
    ),
    required: fields.filter(([k]) => !k.endsWith('?')).map(([k]) => k),
    additionalProperties: false,
  };
}
export const C4_MODEL_SCHEMA = jsonSchema(schema);
