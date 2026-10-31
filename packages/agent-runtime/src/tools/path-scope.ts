import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
};

/** Application-level path validation. This class does not claim OS sandbox isolation. */
export class PathScope {
  readonly root: string;
  private readonly reads: string[];
  private readonly privatePaths: string[];
  private constructor(root: string, reads: string[], privatePaths: string[]) {
    this.root = root;
    this.reads = reads;
    this.privatePaths = privatePaths;
  }
  static async create(
    root: string,
    readDirs: readonly string[],
    privatePaths: string[],
  ): Promise<PathScope> {
    if (![root, ...readDirs, ...privatePaths].every(isAbsolute))
      throw new Error('Scope requires absolute host paths');
    const canonical = await realpath(root);
    return new PathScope(
      canonical,
      await Promise.all(readDirs.map((path) => realpath(path))),
      privatePaths.map((path) => resolve(path)),
    );
  }
  async path(value: string, write = false, allowMissing = false): Promise<string> {
    if (
      value.includes('\0') ||
      /^\\\\|^\\\?\?|(^|[\\/])\.\.([\\/]|$)/.test(value) ||
      /:/.test(value.replace(/^[A-Za-z]:/, ''))
    )
      throw new Error('Unsafe path syntax');
    const target = resolve(this.root, value);
    const roots = write ? [this.root] : [this.root, ...this.reads];
    const root = roots.find((entry) => inside(entry, target));
    if (!root || this.privatePaths.some((entry) => inside(entry, target)))
      throw new Error('Path is outside the allowed scope');
    const parts = relative(root, target).split(sep).filter(Boolean);
    if (
      process.platform === 'win32' &&
      parts.some(
        (part) => /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part),
      )
    )
      throw new Error('Windows device/normalized path aliases are not allowed');
    if (
      parts.some((part) => part.toLowerCase() === '.git') ||
      (write && parts.some((part) => part.toLowerCase() === '.skaro'))
    )
      throw new Error('Protected Skaro/Git metadata requires its existing host handler');
    let current = root;
    for (const [index, part] of parts.entries()) {
      current = resolve(current, part);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink()) throw new Error('Symlinks/reparse points are not traversed');
        if (index < parts.length - 1 && !stat.isDirectory())
          throw new Error('Path parent is not a directory');
      } catch (error) {
        if (
          allowMissing &&
          index === parts.length - 1 &&
          (error as NodeJS.ErrnoException).code === 'ENOENT'
        )
          return current;
        throw error;
      }
    }
    const canonical = await realpath(target);
    if (!inside(root, canonical) || this.privatePaths.some((entry) => inside(entry, canonical)))
      throw new Error('Resolved path escaped its scope');
    return canonical;
  }
}
