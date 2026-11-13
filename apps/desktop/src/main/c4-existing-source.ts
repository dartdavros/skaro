import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { C4Model } from '@skaro/core';
import { requireMemoryPath } from './project-memory-sources';

export interface C4ExistingSource {
  path: string;
  hash: string;
}

/** Versioning an existing current source can preserve behavior; it never grants write permission. */
export async function inspectExistingC4Source(
  checkout: string,
  path: string,
  baseline?: { root: string; model?: C4Model },
): Promise<C4ExistingSource | undefined> {
  if (
    !baseline?.model?.elements.some((e) => e.state === 'current' && e.code.includes(path)) ||
    (await realpath(checkout)) === (await realpath(baseline.root))
  )
    return undefined;
  try {
    const original = await readFile(await requireMemoryPath(baseline.root, path));
    const actual = await readFile(await requireMemoryPath(checkout, path));
    if (!original.equals(actual)) return undefined;
    return { path, hash: createHash('sha256').update(original).digest('hex') };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
