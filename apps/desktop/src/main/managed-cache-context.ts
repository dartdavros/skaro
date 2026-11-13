import type { Stats } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalCachePath, hasCacheControls } from './managed-cache-files';

/** Select a subproject, never another cwd, raw flags or a caller-owned filesystem root. */
export function managedContextArgument(value: unknown = '.'): string {
  if (typeof value !== 'string' || !value || value.length > 512)
    throw new Error('managed_cache_context_invalid');
  if (value === '.') return value;
  if (
    value.trim() !== value ||
    /[\\:]/.test(value) ||
    hasCacheControls(value) ||
    value
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[. ]$/.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    throw new Error('managed_cache_context_invalid');
  return value;
}

const sameDirectory = (a: Stats, b: Stats) =>
  b.isDirectory() &&
  !b.isSymbolicLink() &&
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.birthtimeMs === b.birthtimeMs;

/** Hold the root worktree lease; this selection only narrows where source is read. */
export async function selectManagedCacheContext(root: string, value: unknown = '.') {
  const context = managedContextArgument(value);
  root = await canonicalCachePath(root, root);
  const cwd = await canonicalCachePath(root, resolve(root, context));
  const rootIdentity = await lstat(root),
    contextIdentity = await lstat(cwd);
  if (!rootIdentity.isDirectory() || !contextIdentity.isDirectory())
    throw new Error('managed_cache_context_directory_required');
  return {
    root,
    cwd,
    context,
    async requireCurrent() {
      await canonicalCachePath(root, cwd);
      if (
        !sameDirectory(rootIdentity, await lstat(root)) ||
        !sameDirectory(contextIdentity, await lstat(cwd))
      )
        throw new Error('managed_cache_context_identity_changed');
    },
  };
}
