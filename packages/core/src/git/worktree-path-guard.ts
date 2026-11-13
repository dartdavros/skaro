import type { BigIntStats } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, relative, resolve, sep, isAbsolute } from 'node:path';

/** Remember opened directory identities; a canonical replacement is not the original checkout. */
export class WorktreePathGuard {
  private readonly directories = new Map<string, BigIntStats>();
  private readonly root: string;
  private readonly guard: () => void;
  constructor(root: string, guard: () => void) {
    this.guard = guard;
    this.root = resolve(root);
  }
  async directory(path: string, remember = false): Promise<void> {
    const target = resolve(path);
    const within = relative(this.root, target);
    if (isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`))
      throw new Error('Worktree cleanup path escaped its registered root');
    const stat = await lstat(target, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || resolve(await realpath(target)) !== target)
      throw new Error(`Worktree directory changed during cleanup: ${target}`);
    const original = this.directories.get(target);
    if (original && (original.dev !== stat.dev || original.ino !== stat.ino))
      throw new Error(`Worktree directory was replaced during cleanup: ${target}`);
    if (remember && !original) this.directories.set(target, stat);
    if (target !== this.root) await this.directory(dirname(target));
    this.guard();
  }
  forget(path: string): void {
    this.directories.delete(resolve(path));
  }
  async leaf(path: string): Promise<void> {
    await this.directory(dirname(path));
  }
}
