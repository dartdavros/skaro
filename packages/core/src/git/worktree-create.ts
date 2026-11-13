import { git } from './command.ts';
import { serializedWorktree } from './merge-queue.ts';

export interface WorktreeCreateOptions {
  path: string;
  branch: string;
  base: string;
  /** Restoration never moves or substitutes a preserved branch. Checked after admission. */
  expectedCommit?: string;
}

export async function assertExpectedCheckout(
  repo: string,
  options: Pick<WorktreeCreateOptions, 'branch' | 'expectedCommit'>,
  path?: string,
): Promise<void> {
  if (!options.expectedCommit) return;
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(options.expectedCommit))
    throw new Error('An exact expected commit SHA is required');
  const env = { GIT_NO_REPLACE_OBJECTS: '1' };
  await git(repo, ['cat-file', '-e', `${options.expectedCommit}^{commit}`], { env });
  const head = (
    await git(repo, ['rev-parse', '--verify', `refs/heads/${options.branch}^{commit}`], { env })
  ).stdout.trim();
  if (
    head !== options.expectedCommit ||
    (path &&
      (await git(path, ['rev-parse', '--verify', 'HEAD^{commit}'], { env })).stdout.trim() !== head)
  )
    throw new Error('The preserved task branch or checkout no longer matches its expected commit');
}

export function createWorktree(
  repo: string,
  options: WorktreeCreateOptions,
  requireActive?: () => void,
): Promise<void> {
  return serializedWorktree(repo, async () => {
    await assertExpectedCheckout(repo, options);
    const exists =
      (
        await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${options.branch}`], {
          allowFail: true,
        })
      ).code === 0;
    requireActive?.();
    // An expected revision requires the existing preserved branch, never a replacement branch.
    if (exists) await git(repo, ['worktree', 'add', options.path, options.branch]);
    else if (options.expectedCommit) throw new Error('The preserved task branch is unavailable');
    else await git(repo, ['worktree', 'add', '-b', options.branch, options.path, options.base]);
    await assertExpectedCheckout(repo, options, options.path);
  });
}
