import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type { BuiltinVerificationDependency } from '@skaro/timeline';
import { fingerprint } from './inputs.ts';

const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const identity = (stat: Awaited<ReturnType<typeof lstat>>) => [
  stat.dev,
  stat.ino,
  stat.size,
  stat.mtimeMs,
  stat.ctimeMs,
  stat.nlink,
];

/** Bounded measurements of declared files, including host-selected ignored dependencies. */
export async function captureDependencies(
  supplied: readonly BuiltinVerificationDependency[],
  signal: AbortSignal,
) {
  const policy = structuredClone(supplied);
  if (
    !policy.length ||
    policy.length > 64 ||
    policy.some((item) => !/^[a-zA-Z0-9_-]{1,100}$/.test(item.id) || !isAbsolute(item.path)) ||
    new Set(policy.map((item) => item.id)).size !== policy.length ||
    new Set(policy.map((item) => resolve(item.path))).size !== policy.length
  )
    throw new Error('Invalid host verification dependency policy');
  let total = 0;
  const files = [];
  const observed = [];
  for (const item of policy) {
    signal.throwIfAborted();
    try {
      const path = resolve(item.path);
      const before = await lstat(path);
      if (
        !before.isFile() ||
        before.isSymbolicLink() ||
        before.size > MAX_FILE_BYTES ||
        (await realpath(path)) !== path
      )
        throw new Error('Unsafe dependency');
      const file = await open(path, 'r');
      const hash = createHash('sha256');
      let bytes = 0;
      try {
        if (fingerprint(identity(before)) !== fingerprint(identity(await file.stat())))
          throw new Error('Dependency replaced before reading');
        for await (const chunk of file.createReadStream({ autoClose: false, signal })) {
          bytes += chunk.length;
          total += chunk.length;
          if (bytes > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES)
            throw new Error('Dependency measurement limit exceeded');
          hash.update(chunk);
        }
        if (
          bytes !== before.size ||
          fingerprint(identity(before)) !== fingerprint(identity(await file.stat())) ||
          fingerprint(identity(before)) !== fingerprint(identity(await lstat(path))) ||
          (await realpath(path)) !== path
        )
          throw new Error('Dependency changed while reading');
      } finally {
        await file.close();
      }
      files.push({ id: item.id, path, bytes, sha256: hash.digest('hex') });
      observed.push({ path, identity: fingerprint(identity(before)) });
    } catch {
      signal.throwIfAborted();
      throw new Error(`Declared dependency is unavailable, unsafe or changed: ${item.id}`);
    }
  }
  for (const item of observed) {
    signal.throwIfAborted();
    if (
      item.identity !== fingerprint(identity(await lstat(item.path))) ||
      (await realpath(item.path)) !== item.path
    )
      throw new Error('Declared dependencies changed during measurement');
  }
  return { schema: 1, policy: fingerprint(policy), coverage: 'declared-files-only', files };
}
