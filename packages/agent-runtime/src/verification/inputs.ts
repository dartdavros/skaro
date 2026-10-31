import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PathScope } from '../tools/path-scope.ts';
import { cleanCommandEnvironment } from '../tools/command-env.ts';

const execute = promisify(execFile);
export const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function hashFile(path: string, signal: AbortSignal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest('hex');
}
export interface CheckInputs {
  schema: 1;
  root: string;
  head: string;
  index: string;
  tree: string;
  files: number;
}
/** Conservative whole Git worktree coverage. Ignored/external dependencies remain unproven. */
export async function captureCheckInputs(
  scope: PathScope,
  signal: AbortSignal,
): Promise<CheckInputs> {
  const git = async (args: string[]) =>
    (
      await execute('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], {
        cwd: scope.root,
        env: cleanCommandEnvironment(),
        signal,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 8_388_608,
      })
    ).stdout;
  const root = await realpath((await git(['rev-parse', '--show-toplevel'])).trim());
  if (root !== (await realpath(scope.root)))
    throw new Error('Check scope must be the Git worktree root');
  const metadata = async () => ({
    head: (await git(['rev-parse', 'HEAD'])).trim(),
    index: fingerprint(await git(['ls-files', '--stage', '-z'])),
  });
  const before = await metadata();
  const names = async () =>
    [
      ...new Set(
        (await git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']))
          .split('\0')
          .filter(Boolean),
      ),
    ].sort();
  const paths = await names();
  if (paths.length > 30_000) throw new Error('Verification input catalogue exceeds its limit');
  const manifest: unknown[] = [];
  let total = 0;
  for (const path of paths) {
    signal.throwIfAborted();
    try {
      const absolute = await scope.path(path);
      const stat = await lstat(absolute);
      if (!stat.isFile() || stat.nlink !== 1)
        throw new Error('Verification requires regular non-linked files');
      total += stat.size;
      if (total > 536_870_912) throw new Error('Verification input bytes exceed their limit');
      const hash = await hashFile(absolute, signal);
      const after = await lstat(absolute);
      if (
        stat.size !== after.size ||
        stat.mtimeMs !== after.mtimeMs ||
        stat.ctimeMs !== after.ctimeMs
      )
        throw new Error('Verification input changed while hashing');
      manifest.push([path, stat.mode, hash]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const absolute = resolve(root, path);
      try {
        await lstat(absolute);
      } catch (missing) {
        if ((missing as NodeJS.ErrnoException).code !== 'ENOENT') throw missing;
        manifest.push([path, 'missing']);
        continue;
      }
      throw new Error('Verification input appeared while hashing', { cause: error });
    }
  }
  if (
    fingerprint(before) !== fingerprint(await metadata()) ||
    fingerprint(paths) !== fingerprint(await names())
  )
    throw new Error('Git verification inputs changed while hashing');
  return { schema: 1, root, ...before, tree: fingerprint(manifest), files: paths.length };
}
