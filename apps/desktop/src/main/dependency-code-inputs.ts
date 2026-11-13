import { git, type AppDb } from '@skaro/core';
import type { ProjectContext } from './projects';
import { CompletionStore, type TaskResult, type CompletionOperation } from './completion-store';
import { assertDependencyVersions, dependencySnapshot } from './completion-dependencies';
import { assertResultUnchanged } from './completion-results';

export function dependencyCodeHeads(
  result: TaskResult,
  publications: CompletionOperation[],
): string[] {
  return [
    result.head,
    ...publications
      .filter(
        (op) =>
          op.state === 'completed' &&
          op.commit &&
          op.results.some((r) => r.taskId === result.taskId && r.head === result.head),
      )
      .map((op) => op.commit!),
  ];
}

/** Published inputs survive branch cleanup; unpublished inputs still require their source checks. */
export async function assertAcceptedDependency(
  db: AppDb,
  context: ProjectContext,
  result: TaskResult,
): Promise<void> {
  const artifacts = await context.store.load();
  assertDependencyVersions(
    artifacts,
    dependencySnapshot([result]),
    new CompletionStore(db, context.id),
    result.taskId,
  );
  if (artifacts.tasks.find((t) => t.id === result.taskId)?.status === 'review')
    await assertResultUnchanged(context, result);
  else await git(context.root, ['cat-file', '-e', `${result.head}^{commit}`]);
}
