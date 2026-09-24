import type { ImageRef, Interaction, TimelineEvent } from './model.ts';

/** Environment an adapter projector runs in. Injected so replays of raw logs are deterministic. */
export interface ProjectionContext {
  /** Time (ms) of the raw line being projected. */
  now(): number;
  /** Stores image bytes as an attachment and returns a reference to it. */
  attachImage(image: {
    base64: string;
    mime: string;
    width?: number;
    height?: number;
    path?: string;
  }): ImageRef;
}

export type Emit = (event: TimelineEvent) => void;

// Tolerant accessors for native payloads (principle P3): never throw, return undefined instead.

export type Obj = Record<string, unknown>;

export function obj(value: unknown): Obj | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Obj)
    : undefined;
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Counts added and removed lines of a unified diff. */
export function countDiff(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }
  return { added, removed };
}

type FormField = Extract<Interaction, { kind: 'form' }>['fields'][number];

/** Fields of an MCP elicitation form from its JSON schema (flat object of primitives). */
export function formFields(schema: unknown): FormField[] {
  const root = obj(schema);
  const properties = obj(root?.['properties']) ?? {};
  const required = new Set(
    arr(root?.['required']).filter((r): r is string => typeof r === 'string'),
  );
  return Object.entries(properties).map(([id, raw]) => {
    const prop = obj(raw) ?? {};
    const options = arr(prop['enum'] ?? arr(prop['oneOf']).map((o) => obj(o)?.['const']))
      .filter((o) => o !== undefined)
      .map(String);
    const type = str(prop['type']);
    return {
      id,
      label: str(prop['title']) ?? str(prop['description']) ?? id,
      type: options.length
        ? 'select'
        : type === 'number' || type === 'integer'
          ? 'number'
          : type === 'boolean'
            ? 'boolean'
            : 'text',
      ...(options.length ? { options } : {}),
      ...(required.has(id) ? { required: true } : {}),
    };
  });
}
