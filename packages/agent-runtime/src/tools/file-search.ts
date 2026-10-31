import { readdir, lstat } from 'node:fs/promises';
import { relative, join } from 'node:path';
import ignore from 'ignore';
import type { PathScope } from './path-scope.ts';
import { decodeText, readScopedFile } from './text-file.ts';
import type { ToolArgs } from './schemas.ts';

const displayPath = (root: string, path: string) => {
  const value = relative(root, path).replaceAll('\\', '/');
  return value.startsWith('../') ? path : value;
};

export async function listScopedFiles(scope: PathScope, path: string, signal: AbortSignal) {
  const root = await scope.path(path);
  if (!(await lstat(root)).isDirectory()) return { files: [root], limited: false };
  const files: string[] = [];
  let limited = false;
  async function walk(
    directory: string,
    inherited: { directory: string; rules: ReturnType<typeof ignore> }[],
    depth: number,
  ): Promise<void> {
    signal.throwIfAborted();
    if (depth > 40 || files.length >= 30_000) {
      limited = true;
      return;
    }
    const layers = [...inherited];
    const gitignore = await scope.path(join(directory, '.gitignore')).catch(() => undefined);
    if (gitignore) {
      const contents = decodeText((await readScopedFile(scope, gitignore, signal)).bytes).text;
      layers.push({ directory, rules: ignore().add(contents) });
    }
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      signal.throwIfAborted();
      const target = join(directory, entry.name);
      let ignored = false;
      for (const layer of layers) {
        const name =
          relative(layer.directory, target).replaceAll('\\', '/') +
          (entry.isDirectory() ? '/' : '');
        const match = layer.rules.test(name);
        if (match.ignored) ignored = true;
        else if (match.unignored) ignored = false;
      }
      if (entry.name === '.git' || entry.isSymbolicLink() || ignored) continue;
      if (!(await scope.path(target).catch(() => undefined))) continue;
      if (files.length >= 30_000) {
        limited = true;
        return;
      }
      if (entry.isDirectory()) await walk(target, layers, depth + 1);
      else if (entry.isFile()) files.push(target);
    }
  }
  await walk(root, [], 0);
  return { files, limited };
}

export async function findFiles(
  scope: PathScope,
  args: ToolArgs<'find_files'>,
  signal: AbortSignal,
) {
  const result = await listScopedFiles(scope, args.path ?? '.', signal);
  const files = result.files
    .map((path) => displayPath(scope.root, path))
    .filter((path) => !args.pattern || path.includes(args.pattern));
  return {
    files: files.slice(args.offset, args.offset + args.limit),
    nextOffset: args.offset + args.limit < files.length ? args.offset + args.limit : null,
    scanLimited: result.limited,
  };
}

export async function searchText(
  scope: PathScope,
  args: ToolArgs<'search_text'>,
  signal: AbortSignal,
) {
  const result = await listScopedFiles(scope, args.path ?? '.', signal);
  const matches: { path: string; line: number; text: string; truncated?: boolean }[] = [];
  const skipped: string[] = [];
  const needle = args.caseSensitive ? args.text : args.text.toLowerCase();
  let seen = 0;
  let outputLength = 0;
  for (const path of result.files) {
    signal.throwIfAborted();
    let text: string;
    try {
      text = decodeText((await readScopedFile(scope, path, signal)).bytes).text;
    } catch (error) {
      signal.throwIfAborted();
      skipped.push(relative(scope.root, path));
      if (!(error instanceof Error)) throw error;
      continue;
    }
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!(args.caseSensitive ? line : line.toLowerCase()).includes(needle)) continue;
      if (seen++ < args.offset) continue;
      const preview = line.slice(0, 4096);
      if (matches.length && outputLength + preview.length > 32768)
        return {
          matches,
          nextOffset: args.offset + matches.length,
          scanLimited: result.limited,
          skipped,
        };
      outputLength += preview.length;
      matches.push({
        path: displayPath(scope.root, path),
        line: index + 1,
        text: preview,
        ...(preview.length < line.length ? { truncated: true } : {}),
      });
      if (matches.length > args.limit)
        return {
          matches: matches.slice(0, args.limit),
          nextOffset: args.offset + args.limit,
          scanLimited: result.limited,
          skipped,
        };
    }
  }
  return { matches, nextOffset: null, scanLimited: result.limited, skipped };
}

export async function readText(scope: PathScope, args: ToolArgs<'read_file'>, signal: AbortSignal) {
  const file = await readScopedFile(scope, args.path, signal);
  const decoded = decodeText(file.bytes);
  const lines = decoded.text.split(/\r?\n/);
  let line = args.startLine - 1;
  let column = args.column;
  let text = '';
  let count = 0;
  if (line < lines.length && column > lines[line]!.length)
    throw new Error('Read cursor is beyond the line');
  while (line < lines.length && count < args.maxLines && text.length < 32768) {
    const rest = lines[line]!.slice(column);
    let take = Math.min(rest.length, 32768 - text.length);
    if (take < rest.length && /[\uD800-\uDBFF]/.test(rest[take - 1] ?? '')) take--;
    text += rest.slice(0, take);
    if (take < rest.length) {
      column += take;
      break;
    }
    line++;
    column = 0;
    count++;
    if (line < lines.length && count < args.maxLines && text.length < 32768) text += '\n';
  }
  return {
    path: args.path,
    hash: file.hash,
    encoding: decoded.encoding,
    startLine: args.startLine,
    text,
    nextLine: line < lines.length ? line + 1 : null,
    nextColumn: column,
    totalLines: lines.length,
  };
}
