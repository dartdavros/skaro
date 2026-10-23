import { git } from './command.ts';
import {
  assertLocalChanges,
  LocalChangesChangedError,
  type LocalChangesResolution,
} from './local-changes.ts';
import { captureFiles, type FileImages } from './merge-files.ts';
import { restoreIndexPaths, splitPaths } from './local-index.ts';

/** The task commit stays clean; the two resolved local layers live only in index/worktree. */
export async function localPublicationFiles(
  repo: string,
  before: string,
  commit: string,
  checkout: string,
  local: LocalChangesResolution,
  managed: FileImages,
): Promise<{ paths: string[]; planned: FileImages }> {
  await assertLocalChanges(repo, local.snapshot);
  const changed = async (a: string, b: string) =>
    splitPaths((await git(repo, ['diff', '--name-only', '--no-renames', '-z', a, b])).stdout);
  const paths = [
    ...new Set([
      ...(await changed(before, commit)),
      ...local.snapshot.paths,
      ...(await changed(commit, local.index)),
      ...(await changed(commit, local.working)),
    ]),
  ].filter((path) => !path.startsWith('.skaro/') || managed.has(path));
  const planned = await captureFiles(local.worktree, paths);
  const metadata = await captureFiles(
    checkout,
    paths.filter((path) => managed.has(path)),
  );
  for (const [path, file] of metadata) planned.set(path, file);
  // A resolver's checkout cannot change between its verification and publication.
  if (
    (await git(local.worktree, ['rev-parse', 'HEAD'])).stdout.trim() !== local.working ||
    (await git(local.worktree, ['status', '--porcelain', '--untracked-files=no'])).stdout.trim()
  )
    throw new LocalChangesChangedError();
  return { paths, planned };
}

export async function prepareLocalIndex(
  repo: string,
  index: string,
  commit: string,
  paths: string[],
  local: LocalChangesResolution,
  managed: FileImages,
): Promise<void> {
  await restoreIndexPaths(
    repo,
    index,
    local.index,
    paths.filter((path) => !managed.has(path)),
  );
  await restoreIndexPaths(
    repo,
    index,
    commit,
    paths.filter((path) => managed.has(path)),
  );
}
