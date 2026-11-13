import type { FileDiff } from '../shared/ipc';
import type { RetainedCheckout } from './worktree-retention-model';

/** fileDiff means working copy versus its own HEAD, not last-commit versus parent. */
export function historicalFileDiff(
  saved: RetainedCheckout | undefined,
  tracked: boolean,
): FileDiff {
  if (
    tracked &&
    saved?.trackedClean &&
    saved.trackedClean.head === saved.head &&
    saved.trackedClean.branch === saved.branch
  )
    return { status: 'unchanged', diff: '' };
  throw new Error(
    'The exact historical working-copy diff is unavailable; no saved diff artifact exists',
  );
}
