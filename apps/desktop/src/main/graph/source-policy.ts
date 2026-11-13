import { realpath, readdir, stat } from 'node:fs/promises';
import { readGraphFile as readFile } from './read-file';
import { relative, resolve, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ignore from 'ignore';
import { hash, type SourceFile } from './facts';

const exec = promisify(execFile);
export const slash = (path: string): string => path.replaceAll('\\', '/');
export function allowed(path: string): boolean {
  return (
    !/(^|\/)(?:\.git|node_modules|vendor|dist|build|out|release|coverage|\.venv|venv|__pycache__|\.next|\.svelte-kit|\.cache|\.aws|\.codex|\.agents)(\/|$)/.test(
      path,
    ) &&
    !/(^|\/)(?:\.env(?:\..*)?|[^/]*\.(?:pem|key|p12|pfx)|id_rsa|credentials)(\/|$)/i.test(path) &&
    !/^\.skaro\/(?:imports|attachments|runs|sessions|worktrees|config|secrets)(\/|\.|$)/.test(path)
  );
}
export async function safeSource(root: string, path: string): Promise<string> {
  return sourceInside(await realpath(root), path);
}
async function sourceInside(canonical: string, path: string): Promise<string> {
  if (!path || isAbsolute(path) || path.includes('\0') || !allowed(slash(path)))
    throw new Error('Graph source is outside source policy');
  const file = await realpath(resolve(canonical, path));
  const inside = relative(canonical, file);
  if (
    inside === '..' ||
    inside.startsWith('..\\') ||
    inside.startsWith('../') ||
    isAbsolute(inside)
  )
    throw new Error('Graph source leaves the project root');
  if (!allowed(slash(inside))) throw new Error('Graph source resolves to an excluded file');
  return file;
}
export async function git(root: string, args: string[]): Promise<string> {
  try {
    return (
      await exec('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], {
        encoding: 'utf8',
        timeout: 15_000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      })
    ).stdout;
  } catch {
    return '';
  }
}
export function language(path: string): string {
  if (/\.(?:[cm]?[jt]sx?)$/.test(path)) return 'typescript';
  if (path.endsWith('.svelte')) return 'svelte';
  if (path.endsWith('.py')) return 'python';
  if (/\.(md|mdx)$/.test(path)) return 'markdown';
  if (/\.(yaml|yml)$/.test(path)) return 'yaml';
  if (path.endsWith('.json')) return 'json';
  return 'file';
}
export const textSource = (path: string): boolean =>
  /(?:\.(?:[cm]?[jt]sx?|svelte|py|mdx?|ya?ml|json|toml|txt|css|html|sh|sql|ini|cfg)|(?:^|\/)Dockerfile(?:\.[^/]+)?)$/.test(
    path,
  );
export interface Manifest {
  root: string;
  checkoutId: string;
  head: string;
  fingerprint: string;
  files: SourceFile[];
  skipped: { path: string; message: string }[];
}
export async function scan(
  root: string,
  progress?: (done: number, total: number) => void,
): Promise<Manifest> {
  root = await realpath(root);
  const [tracked, head, gitDir] = await Promise.all([
    git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']),
    git(root, ['rev-parse', 'HEAD']),
    git(root, ['rev-parse', '--absolute-git-dir']),
  ]);
  const skipped: Manifest['skipped'] = [];
  const paths = new Set(tracked.split('\0').filter(Boolean).map(slash));
  async function walk(directory: string, rules = ignore(), depth = 0): Promise<void> {
    if (depth > 40 || paths.size > 30_000) {
      skipped.push({ path: directory, message: 'directory limit' });
      return;
    }
    const local = directory ? `${directory}/` : '';
    try {
      const text = await readFile(resolve(root, local, '.gitignore'), 'utf8');
      rules = ignore()
        .add(rules)
        .add(
          text
            .split('\n')
            .filter((line) => line && !line.startsWith('#'))
            .map((line) => {
              const negated = line.startsWith('!');
              const pattern = negated ? line.slice(1) : line;
              return `${negated ? '!' : ''}${local}${pattern.replace(/^\//, '')}`;
            }),
        );
    } catch {
      /* A directory without .gitignore inherits its parent's rules. */
    }
    for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
      const path = local + entry.name;
      if (
        !allowed(path) ||
        (!path.startsWith('.skaro/') && rules.ignores(path + (entry.isDirectory() ? '/' : '')))
      )
        continue;
      if (entry.isSymbolicLink()) {
        skipped.push({ path, message: 'symbolic link is not traversed' });
        continue;
      }
      if (entry.isDirectory()) await walk(path, rules, depth + 1);
      else if (entry.isFile()) paths.add(path);
    }
  }
  if (!gitDir.trim()) await walk('');
  else {
    try {
      await walk('.skaro');
    } catch {
      /* C4 is optional. */
    }
  }
  const files: SourceFile[] = [];
  const ordered = [...paths].sort();
  const sizes = new Map<string, number>();
  // Reserve the byte budget in path order, independently of asynchronous completion order.
  let sizeIndex = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (sizeIndex < ordered.length) {
        const path = ordered[sizeIndex++]!;
        if (allowed(path) && textSource(path))
          try {
            sizes.set(path, (await stat(resolve(root, path))).size);
          } catch {
            /* Reported by the safe read below. */
          }
      }
    }),
  );
  let totalBytes = 0;
  const accepted = new Set<string>();
  for (const path of ordered) {
    if (!allowed(path) || !textSource(path)) continue;
    const size = sizes.get(path) ?? 0;
    if (
      accepted.size < 30_000 &&
      size <= 2 * 1024 * 1024 &&
      totalBytes + size <= 256 * 1024 * 1024
    ) {
      accepted.add(path);
      totalBytes += size;
    }
  }
  let next = 0,
    done = 0;
  async function readSources(): Promise<void> {
    while (next < ordered.length) {
      const path = ordered[next++]!;
      if (!allowed(path)) {
        skipped.push({ path, message: 'excluded by source policy' });
        continue;
      }
      if (!textSource(path)) {
        skipped.push({ path, message: 'binary or unsupported source format' });
        continue;
      }
      if (!accepted.has(path)) {
        skipped.push({ path, message: 'file or source size limit' });
        continue;
      }
      try {
        const file = await sourceInside(root, path),
          size = sizes.get(path);
        const bytes = await readFile(file);
        if (size !== bytes.length) throw new Error('Source changed while scanning');
        if (bytes.subarray(0, 8192).includes(0)) {
          skipped.push({ path, message: 'binary or unsupported source format' });
          continue;
        }
        files.push({
          path,
          hash: hash(bytes),
          text: bytes.toString('utf8'),
          language: language(path),
        });
      } catch (error) {
        skipped.push({ path, message: `unreadable: ${String(error).slice(0, 180)}` });
      } finally {
        if (++done % 100 === 0) progress?.(done, ordered.length);
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => readSources()));
  files.sort((a, b) => a.path.localeCompare(b.path));
  skipped.sort((a, b) => a.path.localeCompare(b.path));
  const checkoutId = hash(`${root}\0${gitDir.trim()}`).slice(0, 32);
  return {
    root,
    checkoutId,
    head: head.trim(),
    files,
    skipped,
    fingerprint: hash(
      `${head.trim()}\0${files.map((file) => `${file.path}\0${file.hash}`).join('\n')}`,
    ),
  };
}
