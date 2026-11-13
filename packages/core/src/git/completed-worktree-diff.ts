import { git } from './command.ts';
import { WorktreeRemovalBlocked } from './worktree-safety.ts';

/** The disposable untracked payload is removable; surviving or staged tracked edits never are. */
export async function assertCompletedTrackedContent(
  path: string,
  resuming: boolean,
): Promise<void> {
  const common = ['--quiet', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none'];
  try {
    // Payload clearing never stages deletions. Any changed index therefore invalidates our old proof.
    await git(path, ['diff', '--cached', 'HEAD', ...common, '--'], {
      env: { GIT_NO_REPLACE_OBJECTS: '1' },
    });
    await git(
      path,
      [
        'diff',
        'HEAD',
        ...common,
        ...(resuming ? ['--no-renames', '--diff-filter=ACMRTUXB'] : []),
        '--',
      ],
      { env: { GIT_NO_REPLACE_OBJECTS: '1' } },
    );
  } catch {
    throw new WorktreeRemovalBlocked(
      path,
      resuming
        ? 'Surviving or staged tracked content changed after cleanup began'
        : 'Tracked content differs from the preserved commit',
    );
  }
}
