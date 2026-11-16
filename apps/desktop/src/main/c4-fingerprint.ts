import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { authoredBody, c4Hash, git, gitStream, type ProjectArtifacts } from '@skaro/core';
import type { C4TaskScope } from './c4-task-scope';

export const c4ReviewKey = (projectId: string, taskId: string) =>
  `c4.review.${projectId}.${taskId}`;

/** Preserve the existing JSON fingerprint byte-for-byte across arbitrary stream boundaries. */
export function c4DiffHash() {
  const hash = createHash('sha256').update('{"diff":"');
  return {
    write: (chunk: string) => {
      hash.update(JSON.stringify(chunk).slice(1, -1));
    },
    finish: (files: string[][]) =>
      hash.update('","files":').update(JSON.stringify(files)).update('}').digest('hex'),
  };
}

/** Includes staged, unstaged and untracked code, using the task's real Git checkout. */
export async function c4ChangeHash(root: string, baseHead: string, head?: string): Promise<string> {
  const hash = c4DiffHash();
  await gitStream(
    root,
    ['diff', '--binary', baseHead, ...(head ? [head] : []), '--', '.', ':(exclude).skaro'],
    hash.write,
  );
  const others = head
    ? { stdout: '' }
    : await git(root, [
        'ls-files',
        '--others',
        '--exclude-standard',
        '-z',
        '--',
        '.',
        ':(exclude).skaro',
      ]);
  const files = await Promise.all(
    others.stdout
      .split('\0')
      .filter(Boolean)
      .sort()
      .map(async (path) => {
        const fileHash = createHash('sha256');
        for await (const chunk of createReadStream(join(root, path), { encoding: 'base64' }))
          fileHash.update(chunk);
        return [path, fileHash.digest('hex')];
      }),
  );
  return hash.finish(files);
}

export function c4ArchitectureHash(artifacts: ProjectArtifacts, scope?: C4TaskScope): string {
  if (scope?.kind === 'artifacts') return c4Hash('artifact-only');
  if (scope)
    return c4Hash(
      JSON.stringify({
        elements: artifacts.c4?.elements.filter((item) => scope.elements.includes(item.id)),
        relationships: artifacts.c4?.relationships.filter((item) =>
          scope.relationships.includes(item.id),
        ),
        questions: artifacts.c4?.questions.filter((question) =>
          question.affects.some((id) => [...scope.elements, ...scope.relationships].includes(id)),
        ),
        specification: artifacts.c4?.specifications.find((item) => item.id === scope.spec),
        document: authoredBody(artifacts.specs.find((item) => item.id === scope.spec)?.body ?? ''),
      }),
    );
  return c4Hash(JSON.stringify({ model: artifacts.c4, problems: artifacts.c4Problems }));
}
