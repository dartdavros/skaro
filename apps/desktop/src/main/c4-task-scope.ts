import { git, type ProjectArtifacts, type C4Model } from '@skaro/core';
import type { ReviewC4Args } from '@skaro/mcp-server';
import { taskSections } from './task-body';

export interface C4TaskScope {
  kind: 'artifacts' | 'implementation';
  files: string[];
  requirements: string[];
  elements: string[];
  relationships: string[];
  spec?: string;
}

const artifact = (path: string) =>
  /^design\//.test(path) ||
  /^docs\/.+\.(?:md|rst|txt|svg|png|jpe?g|webp|pdf)$/.test(path) ||
  /\.md$/.test(path) ||
  /^(?:LICENSE|NOTICE)(?:\.|$)/.test(path);

/** Scope is derived from Git and the task's own requirements, never the whole specification. */
export function taskC4Scope(
  artifacts: Pick<ProjectArtifacts, 'c4' | 'tasks'>,
  taskId: string,
  files: string[],
): C4TaskScope {
  const task = artifacts.tasks.find((item) => item.id === taskId);
  const sections = taskSections(task?.body ?? '');
  const requirements = [
    ...new Set(
      [sections.goal ?? '', ...sections.criteria.map((item) => item.text)]
        .join('\n')
        .match(/\bR-\d+\b/g) ?? [],
    ),
  ];
  const spec = artifacts.c4?.specifications.find((item) => item.id === task?.spec);
  const covered = spec?.requirements.filter((item) => requirements.includes(item.id)) ?? [];
  const elements = new Set(covered.flatMap((item) => item.elements));
  for (const element of artifacts.c4?.elements ?? [])
    if ([...element.code, ...(element.planned?.code ?? [])].some((path) => files.includes(path)))
      elements.add(element.id);
  return {
    kind: files.length > 0 && files.every(artifact) ? 'artifacts' : 'implementation',
    files,
    requirements,
    elements: [...elements],
    relationships: [...new Set(covered.flatMap((item) => item.relationships))],
    ...(task?.spec ? { spec: task.spec } : {}),
  };
}

export async function readTaskC4Scope(
  root: string,
  baseHead: string,
  artifacts: ProjectArtifacts,
  taskId: string,
): Promise<C4TaskScope> {
  const [changed, untracked] = await Promise.all([
    git(root, ['diff', '--name-only', '-z', baseHead, '--', '.', ':(exclude).skaro']),
    git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', '.', ':(exclude).skaro']),
  ]);
  return taskC4Scope(
    artifacts,
    taskId,
    [...new Set(`${changed.stdout}\0${untracked.stdout}`.split('\0').filter(Boolean))].sort(),
  );
}

export function reviewedC4Ids(
  scope: C4TaskScope,
  review?: ReviewC4Args,
  model?: C4Model,
): Set<string> {
  const ids = new Set([
    ...scope.elements,
    ...scope.relationships,
    ...(review?.elements ?? []),
    ...(review?.relationships ?? []),
  ]);
  for (const relation of model?.relationships ?? []) {
    if (!ids.has(relation.id)) continue;
    ids.add(relation.source);
    ids.add(relation.target);
  }
  return ids;
}
