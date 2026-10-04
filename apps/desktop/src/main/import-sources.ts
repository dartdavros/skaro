import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join, relative, sep } from 'node:path';
import type { SourceInfo, SourceKind } from './import-model';

export const TEXT = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.rst',
  '.adoc',
  '.asciidoc',
  '.yaml',
  '.yml',
  '.json',
]);

const CONVERT = new Set(['.docx', '.html', '.htm', '.pdf', '.csv', '.tsv', '.xlsx']);

export const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

export const ARCHIVE = new Set(['.zip']);

export const SKIP_DIRS = new Set(['.git', 'node_modules', '.skaro', '.svn', '.hg', '__MACOSX']);

/** A source larger than this is read only in part: the import is about documents. */
const MAX_FILES = 3000;

export const MAX_FILE_BYTES = 30 * 1024 * 1024;

export function readable(name: string): boolean {
  const ext = extname(name).toLowerCase();
  return TEXT.has(ext) || CONVERT.has(ext) || IMAGE.has(ext) || ARCHIVE.has(ext);
}

/** "~/Docs/shop" for a folder in the home directory. */
export function displayPath(path: string): string {
  const home = homedir();
  const rel = relative(home, path);
  return rel && !rel.startsWith('..') && !/^[a-z]:/i.test(rel)
    ? `~/${rel.split(sep).join('/')}`
    : path.split(sep).join('/');
}

export async function walk(root: string, out: string[]): Promise<void> {
  if (out.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= MAX_FILES) return;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(path, out);
    } else if (entry.isFile()) out.push(path);
  }
}

async function zipEntries(path: string): Promise<string[]> {
  const { unzipSync } = await import('fflate');
  const names: string[] = [];
  unzipSync(new Uint8Array(await readFile(path)), {
    filter: (file) => {
      if (!file.name.endsWith('/')) names.push(file.name);
      return false;
    },
  });
  return names;
}

/** What is in a source: files, how many Skaro reads, the formats it does not. */
export async function scanSource(path: string): Promise<SourceInfo> {
  const display = displayPath(path);
  const info = await stat(path).catch(() => undefined);
  if (!info) {
    return {
      path,
      display,
      kind: 'file',
      files: 0,
      readable: 0,
      unsupported: 0,
      formats: [],
      missing: true,
    };
  }
  let names: string[];
  let kind: SourceKind;
  if (info.isDirectory()) {
    kind = 'folder';
    const files: string[] = [];
    await walk(path, files);
    names = files;
  } else if (ARCHIVE.has(extname(path).toLowerCase())) {
    kind = 'archive';
    names = await zipEntries(path).catch(() => []);
  } else {
    kind = 'file';
    names = [path];
  }
  const unsupported = names.filter((n) => !readable(n));
  return {
    path,
    display,
    kind,
    files: names.length,
    readable: names.length - unsupported.length,
    unsupported: unsupported.length,
    formats: [...new Set(unsupported.map((n) => extname(n).toLowerCase() || n))].sort(),
  };
}

export function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'source';
}
