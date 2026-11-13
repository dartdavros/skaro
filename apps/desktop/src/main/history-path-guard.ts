import type { BigIntStats } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** One operation's canonical directory identities, including ancestors above its private root. */
export class HistoryPathGuard {
  private readonly root: string;
  private readonly directories = new Map<string, BigIntStats>();
  private constructor(root: string) {
    this.root = resolve(root);
  }
  static async capture(root: string): Promise<HistoryPathGuard> {
    const guard = new HistoryPathGuard(root);
    await guard.directory(root, true);
    return guard;
  }
  async directory(path: string, remember = false): Promise<void> {
    const target = resolve(path),
      within = relative(this.root, target);
    if (isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`))
      throw new Error('Historical export path escaped its registered root');
    const ancestors = [target];
    while (dirname(ancestors.at(-1)!) !== ancestors.at(-1))
      ancestors.push(dirname(ancestors.at(-1)!));
    // Check parents first; the last realpath traverses the entire chain immediately before an effect.
    for (const directory of ancestors.reverse()) {
      const current = await lstat(directory, { bigint: true });
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        resolve(await realpath(directory)) !== directory
      )
        throw new Error('Historical export ancestor is not canonical');
      const original = this.directories.get(directory);
      if (original) assertHistoryDirectoryIdentity(original, current);
      if (!original) {
        if (!remember) throw new Error('Historical export ancestor was not registered');
        this.directories.set(directory, current);
      }
    }
  }
  leaf(path: string): Promise<void> {
    return this.directory(dirname(resolve(path)));
  }
}

/** Device/inode metadata is compared exactly, not rounded through JavaScript numbers. */
export function assertHistoryDirectoryIdentity(
  original: Pick<BigIntStats, 'dev' | 'ino'>,
  current: Pick<BigIntStats, 'dev' | 'ino'>,
): void {
  if (original.dev !== current.dev || original.ino !== current.ino)
    throw new Error('Historical export ancestor identity changed');
}
