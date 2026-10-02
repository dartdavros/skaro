import { realpath } from 'node:fs/promises';
import { git } from './command.ts';

const pending = new Map<string, Promise<unknown>>();

/** Shared across service instances and worktree paths of the same repository. */
export async function serializedMerge<T>(repo: string, action: () => Promise<T>): Promise<T> {
  const dir = (
    await git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  ).stdout.trim();
  const key = await realpath(dir);
  const previous = pending.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(action);
  pending.set(key, current);
  try {
    return await current;
  } finally {
    if (pending.get(key) === current) pending.delete(key);
  }
}
