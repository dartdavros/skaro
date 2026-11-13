import { readFile } from 'node:fs/promises';
import { c4Hash, git } from '@skaro/core';
import { publicMemoryText, requireMemoryPath } from './project-memory-sources';
import type { C4ImpactObservation } from './c4-impact-observation';

/** Real source bytes are read by the host; routine review needs no native shell approval. */
export async function c4SemanticSources(observed: C4ImpactObservation) {
  const sources = [];
  let bytes = 0;
  for (const source of observed.files) {
    let content: string | null;
    if (source.hash !== null) {
      content = await readFile(
        await requireMemoryPath(observed.impact.checkout, source.path),
        'utf8',
      );
      if (c4Hash(content) !== source.hash)
        throw new Error('C4 source changed before reviewer input');
    } else {
      const before = await git(observed.impact.checkout, [
        'show',
        `${observed.impact.baseHead}:${source.path}`,
      ]).catch(() => undefined);
      content = before?.stdout ?? null;
    }
    const baseRef = `${observed.impact.baseHead}:${source.path}`;
    const baseObject = await git(observed.impact.checkout, ['rev-parse', '--verify', baseRef], {
      allowFail: true,
      env: { GIT_NO_REPLACE_OBJECTS: '1' },
    });
    let base: { blob: string; content: string } | null = null;
    if (baseObject.code === 0) {
      const original = await git(observed.impact.checkout, ['show', baseRef], {
        env: { GIT_NO_REPLACE_OBJECTS: '1' },
      });
      const blob = baseObject.stdout.trim();
      const decoded = await git(observed.impact.checkout, ['hash-object', '--stdin'], {
        input: original.stdout,
      });
      if (decoded.stdout.trim() !== blob)
        throw new Error('Independent C4 review cannot certify lossy base source decoding');
      base = { blob, content: original.stdout };
    }
    const workingBlob =
      source.hash === null
        ? null
        : (
            await git(
              observed.impact.checkout,
              ['hash-object', `--path=${source.path}`, '--stdin'],
              {
                input: content!,
              },
            )
          ).stdout.trim();
    bytes += Buffer.byteLength(content ?? '') + Buffer.byteLength(base?.content ?? '');
    if (bytes > 2 * 1024 * 1024)
      throw new Error(
        'C4 source scope exceeds bounded independent-review context; narrow it before dispatch',
      );
    if (content !== null && publicMemoryText(content) !== content)
      throw new Error('Independent C4 review cannot certify redacted source contents');
    if (base && publicMemoryText(base.content) !== base.content)
      throw new Error('Independent C4 review cannot certify redacted base source contents');
    sources.push({
      ...source,
      content: content === null ? null : publicMemoryText(content),
      ...(source.hash === null ? { contentIs: 'base-before-deletion' } : {}),
      base,
      workingBlob,
    });
  }
  return sources;
}
