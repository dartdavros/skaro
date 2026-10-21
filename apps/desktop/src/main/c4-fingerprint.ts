import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { c4Hash, git, type ProjectArtifacts } from '@skaro/core';
import type { C4TaskScope } from './c4-task-scope';

export const c4ReviewKey = (projectId: string, taskId: string) =>
  `c4.review.${projectId}.${taskId}`;

/** Includes staged, unstaged and untracked code, using the task's real Git checkout. */
export async function c4ChangeHash(root: string, baseHead: string, head?: string): Promise<string> {
  const diff = await git(root, [
    'diff',
    '--binary',
    baseHead,
    ...(head ? [head] : []),
    '--',
    '.',
    ':(exclude).skaro',
  ]);
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
      .map(async (path) => [path, c4Hash((await readFile(join(root, path))).toString('base64'))]),
  );
  return c4Hash(JSON.stringify({ diff: diff.stdout, files }));
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
        document: artifacts.specs.find((item) => item.id === scope.spec)?.body,
      }),
    );
  return c4Hash(JSON.stringify({ model: artifacts.c4, problems: artifacts.c4Problems }));
}
