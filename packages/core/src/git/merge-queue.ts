import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { git } from './command.ts';

/** Shared across service instances and worktree paths of the same repository. */
function keyedQueue() {
  const pending = new Map<string, Promise<unknown>>();
  return async function serialize<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = pending.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    pending.set(key, current);
    try {
      return await current;
    } finally {
      if (pending.get(key) === current) pending.delete(key);
    }
  };
}

export function repositoryQueue() {
  const run = keyedQueue();
  return async <T>(repo: string, action: () => Promise<T>) => {
    const dir = (
      await git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    ).stdout.trim();
    return run(await realpath(dir), action);
  };
}

export const serializedMerge = repositoryQueue();
/** Git scans every worktree registration during add/prune, including unfinished ones. */
export const serializedWorktree = repositoryQueue();

const checkoutQueue = keyedQueue();
export function withWorktreePath<T>(path: string, action: () => Promise<T>) {
  const key = resolve(path);
  return checkoutQueue(process.platform === 'win32' ? key.toLowerCase() : key, action);
}

export function mutateWorktree<T>(repo: string, path: string, action: () => Promise<T>) {
  return withWorktreePath(path, () => serializedWorktree(repo, action));
}
