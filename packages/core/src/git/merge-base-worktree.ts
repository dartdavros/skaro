import { lstat, mkdtemp, readdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { git } from './command.ts';
import { GitBaseChangedError } from './git.ts';
import { mutateWorktree } from './merge-queue.ts';

const prefix = 'skaro-base-publication-';
const checkoutName = 'base';
const ownerFile = 'owner';

const pathKey = (path: string) => {
  const absolute = resolve(path);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
};

async function worktreeRecords(repo: string): Promise<string[][]> {
  const { stdout } = await git(repo, ['worktree', 'list', '--porcelain', '-z']);
  return stdout.split('\0\0').map((record) => record.split('\0'));
}

export async function isBaseCheckedOut(repo: string, base: string): Promise<boolean> {
  return (await worktreeRecords(repo)).some((record) =>
    record.includes(`branch refs/heads/${base}`),
  );
}

async function commonGitDir(repo: string): Promise<string> {
  return (
    await git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  ).stdout.trim();
}

async function release(repo: string, dir: string): Promise<void> {
  const checkout = join(dir, checkoutName);
  await mutateWorktree(repo, checkout, async () => {
    const registration = (await worktreeRecords(repo)).find((record) =>
      record.some(
        (entry) => entry.startsWith('worktree ') && pathKey(entry.slice(9)) === pathKey(checkout),
      ),
    );
    if (registration) {
      const info = await lstat(checkout).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (info && (!info.isDirectory() || info.isSymbolicLink()))
        throw new Error('The publication worktree path was replaced');
      // --no-checkout materializes only its Git pointer. Preserve anything added afterwards.
      if (info && (await readdir(checkout)).some((name) => name !== '.git'))
        throw new Error(`Files appeared in the temporary branch reservation: ${checkout}`);
      await git(repo, ['worktree', 'remove', '--force', checkout]);
    }
    await unlink(join(dir, ownerFile));
    await rmdir(dir);
  });
}

/** Git reserves the base against other checkouts while we compare and update its exact ref. */
export async function publishUnoccupiedBase(
  repo: string,
  base: string,
  before: string,
  commit: string,
  validate: () => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(await commonGitDir(repo), prefix));
  const checkout = join(dir, checkoutName);
  await writeFile(join(dir, ownerFile), String(process.pid), { flag: 'wx' });
  try {
    await mutateWorktree(repo, checkout, async () => {
      const created = await git(repo, ['worktree', 'add', '--no-checkout', '--', checkout, base], {
        allowFail: true,
      });
      if (created.code !== 0) {
        if (await isBaseCheckedOut(repo, base)) throw new GitBaseChangedError();
        throw new Error(created.stderr.trim() || 'Could not reserve the base branch');
      }
    });
    const ref = `refs/heads/${base}`;
    if (
      (await git(checkout, ['symbolic-ref', 'HEAD'])).stdout.trim() !== ref ||
      (await git(checkout, ['rev-parse', 'HEAD'])).stdout.trim() !== before
    )
      throw new GitBaseChangedError();
    await validate();
    await git(checkout, ['update-ref', '-m', 'Skaro: merge task', ref, commit, before]);
  } finally {
    await release(repo, dir);
  }
}

/** A crash can leave an empty reservation, but no owner index or files need recovery. */
export async function recoverBasePublications(repo: string, alive: (pid: number) => boolean) {
  const common = await commonGitDir(repo);
  for (const entry of await readdir(common, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const dir = join(common, entry.name);
    const owner = await readFile(join(dir, ownerFile), 'utf8').catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return '';
      },
    );
    const pid = Number(owner);
    if (Number.isSafeInteger(pid) && pid > 0 && !alive(pid)) await release(repo, dir);
  }
}
