import { markResourceCleanupEffect } from '../resources/cleanup-context.ts';
import type { Dir } from 'node:fs';
import { constants } from 'node:fs';
import { lstat, open, opendir, rmdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { WorktreePathGuard } from './worktree-path-guard.ts';

const WORKERS = 4;
const BATCH = 16;

export async function worktreePresent(path: string): Promise<boolean> {
  try {
    const entry = await lstat(path);
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new Error('Worktree path is not a canonical directory');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

interface DirectoryFrame {
  path: string;
  directory: Dir;
  parent?: DirectoryFrame;
  children: number;
  exhausted: boolean;
}

async function drain(operations: Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(operations);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

async function removeLeaf(path: string, scope: WorktreePathGuard): Promise<void> {
  await scope.leaf(path);
  try {
    await unlink(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    // Never chmod by a stale path: use the opened regular file, with no link following.
    const stat = await lstat(path, { bigint: true });
    if (code !== 'EPERM' || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n)
      throw error;
    await scope.leaf(path);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat({ bigint: true });
      if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.nlink !== 1n) throw error;
      await scope.leaf(path);
      await handle.chmod(0o600);
    } finally {
      await handle.close();
    }
    await scope.leaf(path);
    await unlink(path);
  }
}

/** Bounded traversal; revalidate canonical ancestors and consumers before each destructive effect. */
export async function clearWorktreeFiles(
  root: string,
  guard: () => void = () => undefined,
): Promise<void> {
  const target = resolve(root);
  const scope = new WorktreePathGuard(target, guard);
  const openDirectory = async (path: string, parent?: DirectoryFrame): Promise<DirectoryFrame> => {
    await scope.directory(path, true);
    return { path, directory: await opendir(path), parent, children: 0, exhausted: false };
  };
  let workers: DirectoryFrame[][] = [[await openDirectory(target)]];
  const waiting: DirectoryFrame[][] = [];
  const step = async (stack: DirectoryFrame[]) => {
    const current = stack.at(-1)!;
    await scope.directory(current.path);
    if (!current.exhausted) {
      const leaves: string[] = [];
      let child: string | undefined;
      while (leaves.length < BATCH) {
        const entry = await current.directory.read();
        if (!entry) {
          await current.directory.close();
          current.exhausted = true;
          break;
        }
        // Keep Git identity intact until every payload file is gone; interrupted sweeps retry.
        if (current.path === target && entry.name === '.git') continue;
        const path = join(current.path, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          child = path;
          break;
        }
        leaves.push(path);
      }
      await drain(leaves.map((path) => removeLeaf(path, scope)));
      if (child) {
        const frame = await openDirectory(child, current);
        current.children++;
        if (workers.length < WORKERS) workers.push([frame]);
        else stack.push(frame);
        return;
      }
    }
    if (current.exhausted && current.children === 0) {
      if (current.path !== target) {
        await scope.directory(current.path);
        await rmdir(current.path);
        scope.forget(current.path);
      }
      stack.pop();
      if (current.parent) current.parent.children--;
    }
  };
  try {
    markResourceCleanupEffect(target);
    while (workers.length || waiting.length) {
      if (!workers.length) throw new Error('Worktree traversal cannot make progress');
      // Drain all workers before releasing the caller's lifecycle lock, including on failure.
      await drain([...workers].map(step));
      workers = workers.filter((stack) => {
        const frame = stack.at(-1);
        if (!frame) return false;
        if (frame.exhausted && frame.children > 0) {
          waiting.push(stack);
          return false;
        }
        return true;
      });
      for (let i = waiting.length - 1; i >= 0; i--) {
        if (waiting[i]!.at(-1)!.children === 0) workers.push(...waiting.splice(i, 1));
      }
    }
  } finally {
    await Promise.allSettled(
      [...workers, ...waiting]
        .flat()
        .filter((frame) => !frame.exhausted)
        .map(({ directory }) => directory.close()),
    );
  }
}
