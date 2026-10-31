import { open, rename, unlink, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PathScope } from './path-scope.ts';
import { readScopedFile, decodeText, encodeText, fileHash, MAX_FILE_BYTES } from './text-file.ts';
import type { ToolArgs } from './schemas.ts';
import { UnknownToolOutcome } from './effect-error.ts';

/** Exact preconditions plus atomic replacement; never retries an owner's changed file. */
export async function applyFilePatch(
  scope: PathScope,
  args: ToolArgs<'apply_patch'>,
  signal: AbortSignal,
) {
  const target = await scope.path(args.path, true, args.operation === 'create');
  if (args.operation === 'create') {
    if (args.expectedHash !== null || args.content === undefined || args.changes.length)
      throw new Error('Create requires content, null expectedHash and no update hunks');
    signal.throwIfAborted();
    const bytes = encodeText(args.content, { encoding: 'utf8', bom: false, text: '' });
    if (bytes.length > MAX_FILE_BYTES) throw new Error('Created file exceeds the size limit');
    const file = await open(target, 'wx', 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } catch {
      throw new UnknownToolOutcome(
        'File creation may be incomplete; inspect its actual contents before continuing',
      );
    } finally {
      await file.close();
    }
    return { path: args.path, operation: 'create', hash: fileHash(bytes) };
  }
  if (!args.expectedHash || args.content !== undefined)
    throw new Error('Existing files require an exact expectedHash');
  const original = await readScopedFile(scope, target, signal);
  if (original.hash !== args.expectedHash)
    throw new Error('File changed; read it again before patching');
  if (original.stat.nlink !== 1) throw new Error('Hard-linked files cannot be patched');
  const decoded = decodeText(original.bytes);
  let text = decoded.text;
  for (const change of args.changes) {
    const index = text.indexOf(change.before);
    if (index < 0 || text.indexOf(change.before, index + 1) >= 0)
      throw new Error('Patch context is absent or ambiguous');
    text = text.slice(0, index) + change.after + text.slice(index + change.before.length);
  }
  if (args.operation === 'update' && !args.changes.length)
    throw new Error('Update requires exact context hunks');
  if (args.operation === 'delete' && args.changes.length)
    throw new Error('Delete does not accept update hunks');
  const bytes = encodeText(text, decoded);
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Patched file exceeds the size limit');
  const recheck = async () => {
    await scope.path(target, true);
    const current = await readScopedFile(scope, target, signal);
    if (
      current.hash !== original.hash ||
      current.stat.ino !== original.stat.ino ||
      current.stat.mtimeMs !== original.stat.mtimeMs
    )
      throw new Error('Concurrent file change detected; patch was not applied');
    signal.throwIfAborted();
  };
  if (args.operation === 'delete') {
    await recheck();
    await unlink(target);
    return { path: args.path, operation: 'delete' };
  }
  const temporary = join(dirname(target), `.skaro-patch-${randomUUID()}`);
  try {
    const file = await open(temporary, 'wx', original.stat.mode);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await recheck();
    await rename(temporary, target);
    return {
      path: args.path,
      operation: 'update',
      hash: fileHash(bytes),
      encoding: decoded.encoding,
    };
  } finally {
    if (await lstat(temporary).catch(() => undefined)) await unlink(temporary);
  }
}
