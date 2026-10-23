import { copyFile, mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { git } from './command.ts';
import { GitBaseChangedError } from './git.ts';
import {
  captureFiles,
  fileImage,
  putFile,
  restoreFiles,
  sameImage,
  type FileImages,
} from './merge-files.ts';
import { localMergeObstacles } from './merge-safety.ts';
import { identicalUntrackedAdditions } from './merge-identical.ts';
import {
  assertLocalChanges,
  LocalChangesChangedError,
  type LocalChangesResolution,
} from './local-changes.ts';
import { localPublicationFiles, prepareLocalIndex } from './local-publication.ts';
export { captureFiles } from './merge-files.ts';

/** Keep the real index locked, while read-tree carries unrelated staged and unstaged work forward. */
export async function publishMerge(
  repo: string,
  checkout: string,
  before: string,
  commit: string,
  base: string,
  managed: FileImages,
  guards: FileImages = new Map(),
  local?: LocalChangesResolution,
): Promise<void> {
  const index = (
    await git(repo, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])
  ).stdout.trim();
  const gitDir = (await git(repo, ['rev-parse', '--absolute-git-dir'])).stdout.trim();
  const lock = `${index}.lock`;
  const handle = await open(lock, 'wx');
  const lockOwner = `Skaro publication ${process.pid} ${randomUUID()}`;
  const dir = await mkdtemp(join(gitDir, 'skaro-merge-recovery-')).catch(async (error) => {
    await handle.close();
    await rm(lock, { force: true });
    throw error;
  });
  const temporaryIndex = join(dir, 'index');
  const env = { GIT_INDEX_FILE: temporaryIndex };
  let refUpdated = false;
  let touched = false;
  let recovered = false;
  let original: FileImages = new Map();
  let planned: FileImages = new Map();
  try {
    await handle.writeFile(lockOwner);
    await handle.close();
    if (
      (await git(repo, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim() !== base ||
      (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim() !== before
    )
      throw new GitBaseChangedError();
    for (const [path, image] of [...managed, ...guards])
      if (!sameImage(image, await fileImage(join(repo, path))))
        throw new Error(`Merge metadata changed during preparation: ${path}`);
    const obstacles = await localMergeObstacles(repo, before, commit, [...managed.keys()]);
    if (obstacles.some((path) => !local?.snapshot.paths.includes(path)))
      throw new Error(`Local changes would be overwritten: ${obstacles.join(', ')}`);
    const resolved = local
      ? await localPublicationFiles(repo, before, commit, checkout, local, managed)
      : undefined;
    const paths =
      resolved?.paths ??
      (await git(repo, ['diff', '--name-only', '--no-renames', '-z', before, commit])).stdout
        .split('\0')
        .filter(Boolean);
    original = await captureFiles(repo, paths);
    planned = resolved?.planned ?? (await captureFiles(checkout, paths));
    await copyFile(index, temporaryIndex);
    await copyFile(index, join(dir, 'original-index'));
    if (local) await prepareLocalIndex(repo, temporaryIndex, commit, paths, local, managed);
    await writeFile(
      join(dir, 'journal.json'),
      JSON.stringify({
        base,
        before,
        commit,
        ownerPid: process.pid,
        lockOwner,
        original: [...original],
        planned: [...planned],
      }),
    );
    // Managed metadata is explicitly part of this commit. Other .skaro files retain their staging.
    if (local) {
      await assertLocalChanges(repo, local.snapshot);
      // Check unrelated dirty paths touched by an agent's compatibility edits as well.
      const extra = await localMergeObstacles(repo, before, local.working, [...managed.keys()]);
      if (extra.some((path) => !local.snapshot.paths.includes(path)))
        throw new LocalChangesChangedError(extra);
      touched = true;
      await restoreFiles(repo, planned, original);
    } else {
      const metadata = [...managed.keys()].filter((path) => paths.includes(path));
      if (metadata.length)
        await git(repo, ['restore', `--source=${commit}`, '--staged', '--', ...metadata], { env });
      const untracked = (await git(repo, ['ls-files', '--others', '-z'])).stdout
        .split('\0')
        .filter((path) => paths.includes(path));
      const identical = await identicalUntrackedAdditions(repo, before, commit, untracked);
      // Adopt matching additions only in the private index. Their working files need no write.
      if (identical.length)
        await git(
          repo,
          ['--literal-pathspecs', 'restore', `--source=${commit}`, '--staged', '--', ...identical],
          { env },
        );
      // Dry run checks Git's own index/worktree rules before touching any files.
      // Managed files will match the staged target when the actual update runs.
      touched = true;
      for (const path of metadata) await putFile(join(repo, path), planned.get(path)!);
      await git(repo, ['read-tree', '-n', '-m', '-u', before, commit], { env });
      await git(repo, ['read-tree', '-m', '-u', before, commit], { env });
    }
    await git(repo, [
      'update-ref',
      '-m',
      'Skaro: merge task',
      `refs/heads/${base}`,
      commit,
      before,
    ]);
    refUpdated = true;
    await copyFile(temporaryIndex, lock);
    await rename(lock, index);
    recovered = true;
  } catch (error) {
    try {
      if (refUpdated) await git(repo, ['update-ref', `refs/heads/${base}`, before, commit]);
      if (touched) await restoreFiles(repo, original, planned);
      recovered = true;
    } catch (recoveryError) {
      throw new AggregateError([error, recoveryError], `Merge recovery retained at ${dir}`, {
        cause: recoveryError,
      });
    }
    throw error;
  } finally {
    await handle.close();
    await rm(lock, { force: true });
    if (recovered) await rm(dir, { recursive: true, force: true });
  }
}
