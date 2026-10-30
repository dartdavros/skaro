import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { git } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import { integrationEnvironmentKey, type IntegrationOperation } from './integration-model';
import { errorText } from './session-log';
import { backgroundWork } from './background-work';

/**
 * A finished candidate (applied or superseded) keeps its record and journal; its environment and
 * checkout are never used again. The environment goes first: its containers mount the checkout.
 */
export async function retireIntegration(ctx: TaskRunEngine, op: IntegrationOperation) {
  if (!['applied', 'stale'].includes(op.state) || op.worker || op.executor) return;
  if (!existsSync(op.worktree)) return;
  await backgroundWork
    .run(
      'merge.retire',
      {
        project: ctx.deps.db.getProject(op.projectId)?.name ?? '',
        task: op.taskId,
        merge: op.id.slice(0, 8),
      },
      async () => {
        await ctx.removeEnvironment(integrationEnvironmentKey(op));
        const service = ctx.project(op.projectId).git;
        if (await registeredWorktree(service.repo, op.worktree))
          await service.removeDetachedWorktree(op.worktree);
        // Git already forgot it (pruned): what is left is Skaro's own folder of this candidate.
        else await rm(op.worktree, { recursive: true, force: true });
      },
    )
    .catch((error: unknown) => console.error(`integration ${op.id} cleanup: ${errorText(error)}`));
}

async function registeredWorktree(repo: string, path: string): Promise<boolean> {
  const list = await git(repo, ['worktree', 'list', '--porcelain']);
  const target = resolve(path).toLowerCase();
  return list.stdout
    .split('\n')
    .some(
      (line) =>
        line.startsWith('worktree ') && resolve(line.slice(9).trim()).toLowerCase() === target,
    );
}
