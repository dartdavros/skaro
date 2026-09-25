// Files for the task screen: "@" suggestions, links to files in agent text, images shown in the
// feed. Paths from the renderer are always resolved inside a known folder.

import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, normalize, relative, resolve, sep } from 'node:path';
import type { PathSuggestion } from '../shared/ipc';

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
};

export function isImagePath(path: string): boolean {
  return extname(path).toLowerCase() in IMAGE_TYPES;
}

/** `path` (relative to `root` or absolute) if it stays inside `root`, otherwise undefined. */
export function inside(root: string, path: string): string | undefined {
  const abs = resolve(root, normalize(path));
  const rel = relative(root, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  return abs;
}

const listCache = new Map<string, { at: number; files: Promise<string[]> }>();

/** Tracked and untracked (not ignored) files of a working folder. */
function listFiles(cwd: string): Promise<string[]> {
  const hit = listCache.get(cwd);
  if (hit && Date.now() - hit.at < 5000) return hit.files;
  const files = new Promise<string[]>((done) => {
    execFile(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout) => done(error ? [] : String(stdout).split('\0').filter(Boolean)),
    );
  });
  listCache.set(cwd, { at: Date.now(), files });
  return files;
}

/** Files and folders for the "@" menu: best matches of the query first. */
export async function suggestPaths(
  cwd: string,
  query: string,
  limit = 30,
): Promise<PathSuggestion[]> {
  const files = await listFiles(cwd);
  const folders = new Set<string>();
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) folders.add(`${parts.slice(0, i).join('/')}/`);
  }
  const q = query.trim().toLowerCase();
  const all: PathSuggestion[] = [
    ...[...folders].map((path) => ({ path, kind: 'folder' as const })),
    ...files.map((path) => ({ path, kind: 'file' as const })),
  ];
  if (!q) {
    return all
      .filter((s) => s.path.split('/').filter(Boolean).length === 1)
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, limit);
  }
  const scored: { s: PathSuggestion; score: number }[] = [];
  for (const s of all) {
    const path = s.path.toLowerCase();
    const name = path.replace(/\/$/, '').split('/').pop() ?? path;
    let score: number;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(q)) score = 1;
    else if (path.includes(q)) score = 2;
    else continue;
    scored.push({ s, score: score * 1000 + path.length });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((x) => x.s);
}

/** Which paths exist inside the working folder (agent text links a path only if it does). */
export function existingPaths(cwd: string, paths: string[]): string[] {
  return paths.filter((p) => {
    const abs = inside(cwd, p.replace(/:\d+(?::\d+)?$/, ''));
    return abs !== undefined && existsSync(abs);
  });
}

export function resolveInside(cwd: string, path: string): string {
  const abs = inside(cwd, path.replace(/:\d+(?::\d+)?$/, ''));
  if (!abs || !existsSync(abs)) throw new Error(`no such file: ${path}`);
  return abs;
}

/** Image bytes for `skaro-media:` URLs, only from the allowed folders or picked files. */
export async function readImage(
  path: string,
  allowed: (abs: string) => boolean,
): Promise<{ bytes: Buffer; mime: string } | undefined> {
  const abs = resolve(path);
  const mime = IMAGE_TYPES[extname(abs).toLowerCase()];
  if (!mime || !allowed(abs)) return undefined;
  try {
    if (!statSync(abs).isFile()) return undefined;
    return { bytes: await readFile(abs), mime };
  } catch {
    return undefined;
  }
}

export function within(root: string, abs: string): boolean {
  const rel = relative(root, abs);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith(sep);
}
