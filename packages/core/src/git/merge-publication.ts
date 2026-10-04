import { copyFile, mkdtemp, open, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from './command.ts';
import {
  captureFiles,
  fileImage,
  putFile,
  restoreFiles,
  sameImage,
  type FileImages,
} from './merge-files.ts';
import { localMergeObstacles } from './merge-safety.ts';
export { captureFiles } from './merge-files.ts';

/** Keep the real index locked, while read-tree carries unrelated staged and unstaged work forward. */
export async function publishMerge(
  repo: string,
  checkout: string,
  before: string,
  commit: string,
  base: string,
  managed: FileImages,
): Promise<void> {
  const index = (
    await git(repo, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])
  ).stdout.trim();
  const gitDir = (await git(repo, ['rev-parse', '--absolute-git-dir'])).stdout.trim();
  const lock = `${index}.lock`;
  const handle = await open(lock, 'wx');
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
    await handle.close();
    if (
      (await git(repo, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim() !== base ||
      (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim() !== before
    )
      throw new Error('The base branch changed; merge must be checked again');
    for (const [path, image] of managed)
      if (!sameImage(image, await fileImage(join(repo, path))))
        throw new Error(`Merge metadata changed during preparation: ${path}`);
    const obstacles = await localMergeObstacles(repo, before, commit, [...managed.keys()]);
    if (obstacles.length)
      throw new Error(`Local changes would be overwritten: ${obstacles.join(', ')}`);
    const paths = (
      await git(repo, ['diff', '--name-only', '--no-renames', '-z', before, commit])
    ).stdout
      .split('\0')
      .filter(Boolean);
    original = await captureFiles(repo, paths);
    planned = await captureFiles(checkout, paths);
    await copyFile(index, temporaryIndex);
    await copyFile(index, join(dir, 'original-index'));
    await writeFile(
      join(dir, 'journal.json'),
      JSON.stringify({ base, before, commit, original: [...original], planned: [...planned] }),
    );
    // Managed metadata is explicitly part of this commit. Other .skaro files retain their staging.
    const metadata = [...managed.keys()].filter((path) => paths.includes(path));
    if (metadata.length)
      await git(repo, ['restore', `--source=${commit}`, '--staged', '--', ...metadata], { env });
    // Dry run checks Git's own index/worktree rules before touching any files.
    // Managed files will match the staged target when the actual update runs.
    touched = true;
    for (const path of metadata) await putFile(join(repo, path), planned.get(path)!);
    await git(repo, ['read-tree', '-n', '-m', '-u', before, commit], { env });
    await git(repo, ['read-tree', '-m', '-u', before, commit], { env });
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
