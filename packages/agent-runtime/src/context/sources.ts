import { createHash } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';
import type { BuiltinContextConfig } from '@skaro/timeline';
import type { PathScope } from '../tools/path-scope.ts';
import { readScopedFile, decodeText } from '../tools/text-file.ts';
import type { ContextSnapshot, ContextSource } from './model.ts';
import { inspectSkill } from './skills.ts';

export const contextHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function source(
  scope: PathScope,
  entry: { id: string; path: string; kind: ContextSource['kind'] },
  signal: AbortSignal,
): Promise<ContextSource> {
  const file = await readScopedFile(scope, entry.path, signal);
  const text = decodeText(file.bytes).text;
  return {
    ...entry,
    revision: file.hash,
    bytes: file.bytes.length,
    lines: text.split(/\r?\n/).length,
    ...(entry.kind === 'scope-instructions' ? { exactText: text } : {}),
  };
}
export async function collectContext(
  scope: PathScope,
  config: BuiltinContextConfig,
  signal: AbortSignal,
): Promise<ContextSnapshot> {
  if (
    config.documents.length > 128 ||
    config.pins.length > 128 ||
    new Set(config.pins.map((pin) => pin.id)).size !== config.pins.length ||
    new Set(config.documents.map((doc) => doc.id)).size !== config.documents.length
  )
    throw new Error('Invalid or oversized context catalogue');
  for (const pin of config.pins)
    if (
      !pin.id ||
      !pin.revision ||
      !pin.text ||
      !['host', 'owner'].includes(pin.origin) ||
      !['goal', 'constraint', 'decision', 'open-question', 'evidence', 'note'].includes(pin.kind)
    )
      throw new Error('Invalid host context pin');
  const directory = await scope.path(config.scopePath);
  const rel = relative(scope.root, directory);
  if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(scope.root, rel) !== directory)
    throw new Error('Instruction scope must be within cwd');
  const sources: ContextSource[] = [];
  const parts = rel.split(sep).filter(Boolean);
  for (let depth = 0; depth <= parts.length; depth++) {
    const path = [...parts.slice(0, depth), 'AGENTS.md'].join('/');
    try {
      sources.push(
        await source(scope, { id: `scope:${path}`, path, kind: 'scope-instructions' }, signal),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  for (const doc of config.documents) {
    if (
      !doc.id ||
      doc.id.startsWith('scope:') ||
      !['task', 'adr', 'c4', 'document', 'skill'].includes(doc.kind)
    )
      throw new Error('Invalid context document');
    const entry = await source(scope, doc, signal);
    if (doc.kind === 'skill') {
      const skill = await inspectSkill(scope, doc, signal);
      if (skill.revision !== entry.revision)
        throw new Error('Skill changed during context collection');
      entry.skill = { name: skill.name, description: skill.description };
    }
    sources.push(entry);
  }
  const value = { schema: 1 as const, pins: structuredClone(config.pins), sources };
  if (Buffer.byteLength(JSON.stringify(value)) > 1_048_576)
    throw new Error('Exact context constraints exceed the size limit');
  return { ...value, revision: contextHash(value) };
}

/** Every page checks the original full-byte revision; changed/removed documents cannot look current. */
export async function contextPage(
  scope: PathScope,
  snapshot: ContextSnapshot,
  id: string,
  cursor: number,
  limit: number,
  signal: AbortSignal,
) {
  if (
    !Number.isSafeInteger(cursor) ||
    cursor < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 16_384
  )
    throw new Error('Invalid context page cursor');
  const entry = snapshot.sources.find((entry) => entry.id === id);
  if (!entry) throw new Error('Unknown context source');
  const file = await readScopedFile(scope, entry.path, signal);
  if (file.hash !== entry.revision) throw new Error('Context source changed; refresh required');
  const text = decodeText(file.bytes).text;
  if (cursor > text.length) throw new Error('Context cursor is beyond the source');
  if (
    cursor &&
    /[\uDC00-\uDFFF]/.test(text[cursor] ?? '') &&
    /[\uD800-\uDBFF]/.test(text[cursor - 1] ?? '')
  )
    throw new Error('Context cursor splits a Unicode character');
  let end = Math.min(text.length, cursor + limit);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1] ?? '')) end--;
  if (end === cursor && cursor < text.length)
    throw new Error('Context page limit splits a Unicode character');
  return {
    id,
    revision: entry.revision,
    text: text.slice(cursor, end),
    nextCursor: end < text.length ? end : null,
  };
}
