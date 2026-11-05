import type { ArtifactFiles } from './files.ts';

// Settings and environment setup share one queue per project in the main process.
const pending = new Map<string, Promise<unknown>>();
export async function serializeConfig<T>(
  files: ArtifactFiles,
  action: () => Promise<T>,
): Promise<T> {
  const key = files.dir;
  const next = (pending.get(key) ?? Promise.resolve()).catch(() => undefined).then(action);
  pending.set(key, next);
  try {
    return await next;
  } finally {
    if (pending.get(key) === next) pending.delete(key);
  }
}
