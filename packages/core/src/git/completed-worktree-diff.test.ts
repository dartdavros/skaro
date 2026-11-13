import { realpath } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { git } from './command.ts';
import { assertCompletedTrackedContent } from './completed-worktree-diff.ts';

it('uses the actual current checkout to preserve staged and surviving tracked changes on retry', async () => {
  const path = await realpath(process.cwd());
  const options = { env: { GIT_NO_REPLACE_OBJECTS: '1' } };
  const staged = (
    await git(
      path,
      ['diff', '--cached', 'HEAD', '--name-only', '--no-ext-diff', '--no-textconv'],
      options,
    )
  ).stdout.trim();
  const changed = (
    await git(
      path,
      [
        'diff',
        'HEAD',
        '--name-status',
        '--no-renames',
        '--ignore-submodules=none',
        '--no-ext-diff',
        '--no-textconv',
      ],
      options,
    )
  ).stdout.trim();
  const surviving = changed.split('\n').some((line) => line && !line.startsWith('D\t'));
  const fresh = assertCompletedTrackedContent(path, false);
  if (staged || changed) await expect(fresh).rejects.toThrow('Tracked content differs');
  else await expect(fresh).resolves.toBeUndefined();
  const resumed = assertCompletedTrackedContent(path, true);
  if (staged || surviving)
    await expect(resumed).rejects.toThrow('Surviving or staged tracked content changed');
  else await expect(resumed).resolves.toBeUndefined();
});
