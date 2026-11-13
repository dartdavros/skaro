import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { delimiter, isAbsolute, parse } from 'node:path';
import { canonicalCachePath, hasCacheControls } from './managed-cache-files';

/** No registry tokens, proxy credentials, TLS material, CLI context or user-home fallback. */
export function minimalManagedDockerEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { DOCKER_CLI_HINTS: 'false', NO_COLOR: '1' };
  for (const key of [
    'PATH',
    'Path',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'PATHEXT',
    'COMSPEC',
    'ProgramFiles',
    'ProgramData',
  ]) {
    const value = source[key];
    if (value)
      env[key] = ['PATH', 'Path'].includes(key)
        ? value
            .split(delimiter)
            .filter((part) => isAbsolute(part))
            .join(delimiter)
        : value;
  }
  return env;
}

/** Installed binaries are streamed, never loaded into a source-sized allocation or copied into caches. */
export async function managedDockerToolDigest(path: string) {
  if (!isAbsolute(path) || hasCacheControls(path) || (await realpath(path)) !== path)
    throw new Error('managed_docker_tool_path_unverified');
  await canonicalCachePath(parse(path).root, path);
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await file.stat();
    // Genuine installed tools may have vendor hardlinks; they are read-only inputs, not owned CAS files.
    if (!before.isFile() || before.nlink < 1 || before.size < 1 || before.size > 256 * 1024 ** 2)
      throw new Error('managed_docker_tool_file_unverified');
    const hash = createHash('sha256'),
      buffer = Buffer.alloc(64 * 1024);
    let offset = 0;
    for (;;) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
      if (!bytesRead) break;
      offset += bytesRead;
      if (offset > before.size) throw new Error('managed_docker_tool_changed');
      hash.update(buffer.subarray(0, bytesRead));
    }
    const after = await file.stat();
    if (
      offset !== before.size ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.nlink !== after.nlink ||
      before.birthtimeMs !== after.birthtimeMs ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    )
      throw new Error('managed_docker_tool_changed');
    return hash.digest('hex');
  } finally {
    await file.close();
  }
}
