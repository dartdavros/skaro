import { git } from './command.ts';

export async function commitAll(worktree: string, message: string): Promise<boolean> {
  await git(worktree, ['add', '-A']);
  if ((await git(worktree, ['diff', '--cached', '--quiet'], { allowFail: true })).code === 0)
    return false;
  await git(worktree, ['commit', '--no-verify', '-q', '-m', message]);
  return true;
}
