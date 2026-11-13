import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';

export interface HistoryEntry {
  version: 2;
  name: string;
  identity: string;
  digest: string;
  commit?: string;
  bytes: number;
  usedAt: number;
  generation: number;
  phase: 'writing' | 'ready' | 'retained' | 'legacy';
  pending?: string;
}
const digestPattern = /^[a-f0-9]{64}$/;
const namePattern = /^[a-f0-9]{64}-[a-zA-Z0-9._-]{1,100}$/;
export const historyKey = (project: string) => `history.files.${project}`;
export const historyDigest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Pure, strict decoding: malformed or duplicate ownership is never an empty inventory. */
export function historyEntries(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) throw new Error('Historical export inventory is invalid');
  const names = new Set<string>();
  const entries = value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object')
      throw new Error('Historical export inventory is invalid');
    const e = entry as Record<string, unknown>;
    if (
      typeof e.name !== 'string' ||
      !namePattern.test(e.name) ||
      names.has(e.name) ||
      typeof e.digest !== 'string' ||
      !digestPattern.test(e.digest) ||
      !Number.isSafeInteger(e.bytes) ||
      Number(e.bytes) < 0 ||
      Number(e.bytes) > 8 * 1024 ** 2 ||
      !Number.isSafeInteger(e.usedAt) ||
      Number(e.usedAt) < 0
    )
      throw new Error('Historical export inventory is invalid');
    names.add(e.name);
    if (
      e.version === undefined &&
      Object.keys(e).every((key) => ['name', 'digest', 'bytes', 'usedAt'].includes(key))
    )
      return {
        ...e,
        version: 2,
        identity: e.name.slice(0, 64),
        generation: 1,
        phase: 'legacy',
      } as HistoryEntry;
    if (
      Object.keys(e).some(
        (key) =>
          ![
            'version',
            'name',
            'identity',
            'digest',
            'commit',
            'bytes',
            'usedAt',
            'generation',
            'phase',
            'pending',
          ].includes(key),
      ) ||
      e.version !== 2 ||
      typeof e.identity !== 'string' ||
      !digestPattern.test(e.identity) ||
      !e.name.startsWith(`${e.identity}-`) ||
      !Number.isSafeInteger(e.generation) ||
      Number(e.generation) < 1 ||
      !['writing', 'ready', 'retained', 'legacy'].includes(String(e.phase)) ||
      (e.commit !== undefined &&
        (typeof e.commit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(e.commit))) ||
      (e.phase !== 'legacy' && !e.commit) ||
      (e.pending !== undefined &&
        (typeof e.pending !== 'string' || e.pending !== `${e.name}.pending`)) ||
      (e.phase === 'writing' && !e.pending)
    )
      throw new Error('Historical export inventory is invalid');
    return e as unknown as HistoryEntry;
  });
  const paths = entries.flatMap((entry) => [entry.name, ...(entry.pending ? [entry.pending] : [])]);
  if (new Set(paths).size !== paths.length)
    throw new Error('Historical export inventory is invalid');
  return entries;
}

export function newHistoryEntry(commit: string, path: string, bytes: Buffer): HistoryEntry {
  const identity = createHash('sha256').update(`${commit}\0${path}`).digest('hex');
  const name = `${identity}-${randomUUID()}-${
    basename(path)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(-60) || 'file'
  }`;
  return {
    version: 2,
    name,
    identity,
    digest: historyDigest(bytes),
    commit,
    bytes: bytes.length,
    usedAt: Date.now(),
    generation: 1,
    phase: 'writing',
    pending: `${name}.pending`,
  };
}
