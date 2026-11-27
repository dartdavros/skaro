import { copyFile, readFile, readdir, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { git } from './command.ts';
import { fileImage, restoreFiles, sameImage, type FileImage } from './merge-files.ts';
import { recoverBasePublications } from './merge-base-worktree.ts';

interface PublicationJournal {
  base: string;
  before: string;
  commit: string;
  ownerPid?: number;
  lockOwner?: string;
  original: [string, FileImage][];
  planned: [string, FileImage][];
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** Called under the repository's publication queue. Unknown/concurrent edits stop recovery. */
export async function recoverPublications(repo: string): Promise<boolean> {
  await recoverBasePublications(repo, alive);
  const gitDir = (await git(repo, ['rev-parse', '--absolute-git-dir'])).stdout.trim();
  const entries = (await readdir(gitDir)).filter((name) =>
    name.startsWith('skaro-merge-recovery-'),
  );
  if (!entries.length) return false;
  const index = (
    await git(repo, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])
  ).stdout.trim();
  for (const entry of entries) {
    const dir = join(gitDir, entry);
    const blocked = () =>
      new Error(`Publication needs recovery; preserve files and index at ${dir}`);
    const journal = JSON.parse(
      await readFile(join(dir, 'journal.json'), 'utf8'),
    ) as PublicationJournal;
    if (!journal.ownerPid || !journal.lockOwner || alive(journal.ownerPid)) throw blocked();
    if ((await git(repo, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim() !== journal.base)
      throw blocked();
    const head = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
    if (head !== journal.before && head !== journal.commit) throw blocked();
    for (const [path] of [...journal.original, ...journal.planned]) {
      const rel = relative(resolve(repo), resolve(repo, path));
      if (
        !rel ||
        isAbsolute(rel) ||
        rel === '..' ||
        rel.startsWith(`..\\`) ||
        rel.startsWith('../')
      )
        throw blocked();
    }
    const original = new Map(journal.original);
    const planned = new Map(journal.planned);
    for (const [path, image] of original) {
      const current = await fileImage(join(repo, path));
      const next = planned.get(path);
      if (
        !next ||
        (!sameImage(current, next) && (head === journal.commit || !sameImage(current, image)))
      )
        throw blocked();
    }
    const oldIndex = await readFile(join(dir, 'original-index'));
    const targetIndex = await readFile(join(dir, 'index'));
    const currentIndex = await readFile(index);
    if (
      !currentIndex.equals(oldIndex) &&
      !(head === journal.commit && currentIndex.equals(targetIndex))
    )
      throw blocked();
    const lock = `${index}.lock`;
    let lockBytes: Buffer | undefined;
    try {
      lockBytes = await readFile(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (lockBytes && lockBytes.toString() !== journal.lockOwner && !lockBytes.equals(targetIndex))
      throw blocked();
    if (head === journal.commit) {
      // Publication reached the ref update; finish its index swap. The worktree already matches.
      if (!currentIndex.equals(targetIndex)) {
        if (!lockBytes) throw blocked();
        await copyFile(join(dir, 'index'), lock);
        await rename(lock, index);
      }
    } else {
      // Publication did not reach the ref update; restore only its known changes.
      await restoreFiles(repo, original, planned);
    }
    if (lockBytes) await rm(lock, { force: true });
    await rm(dir, { recursive: true });
  }
  return true;
}
