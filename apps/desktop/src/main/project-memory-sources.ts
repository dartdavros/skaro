import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { ProjectArtifacts } from '@skaro/core';

export const memoryVersion = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Only authored public artifacts enter memory; configuration, credentials and raw logs do not. */
export function memoryDocuments(artifacts: ProjectArtifacts) {
  return [
    artifacts.brief,
    artifacts.architecture,
    ...artifacts.docs,
    ...artifacts.adrs,
    ...artifacts.specs,
    ...artifacts.tasks,
  ].filter((entry) => entry !== undefined);
}

export async function requireMemoryPath(root: string, path: string): Promise<string> {
  const base = await realpath(root);
  const actual = await realpath(resolve(base, path));
  const suffix = relative(base, actual);
  if (!suffix || suffix.startsWith('..') || isAbsolute(suffix))
    throw new Error('Memory source is outside its registered scope');
  return actual;
}

/** Defence in depth for accidental inline credentials; private input stores are never read. */
export function publicMemoryText(text: string): string {
  return text
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      '[private key redacted]',
    )
    .replace(/\b(Bearer\s+)[\w.+\-/=]+/gi, '$1[redacted]')
    .replace(
      /\b((?:api[_-]?key|password|passwd|secret|access[_-]?token|authorization)(?:\\?["'])?\s*[=:]\s*)(\\?["'].*?\\?["']|[^\s,;}\]]+)/gi,
      (_match, prefix: string, value: string) => {
        const quote = value.match(/^\\?["']/)?.[0] ?? '';
        return `${prefix}${quote}[redacted]${quote}`;
      },
    );
}
