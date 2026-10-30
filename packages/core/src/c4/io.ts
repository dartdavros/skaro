import { replaceFile } from '../fs-replace.ts';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

const pending = new Map<string, Promise<unknown>>();
let sharedLocks: Int32Array | undefined;
let lockOwner = 1;

/** The desktop passes the same table to its main thread and background workers. */
export function configureC4Locks(buffer: SharedArrayBuffer, owner: number): void {
  sharedLocks = new Int32Array(buffer);
  lockOwner = owner;
}
async function locked<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const locks = sharedLocks;
  if (!locks) return operation();
  let hash = 0;
  const path = process.platform === 'win32' ? root.toLowerCase() : root;
  for (let i = 0; i < path.length; i++) hash = (hash * 31 + path.charCodeAt(i)) >>> 0;
  const slot = hash % locks.length;
  while (Atomics.compareExchange(locks, slot, 0, lockOwner) !== 0)
    await new Promise((resolve) => setTimeout(resolve, 5));
  try {
    return await operation();
  } finally {
    Atomics.store(locks, slot, 0);
    Atomics.notify(locks, slot);
  }
}

/** Serialize architecture reads/writes in this service, including interrupted transaction recovery. */
export async function withC4Lock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const previous = pending.get(root) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => locked(root, operation));
  pending.set(root, current);
  try {
    return await current;
  } finally {
    if (pending.get(root) === current) pending.delete(root);
  }
}

export async function readC4File(root: string, path: string): Promise<string | null> {
  const file = await c4Path(root, path);
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Refuse traversal and links pointing outside the actual project, including new descendants. */
export async function c4Path(root: string, path: string): Promise<string> {
  if (
    isAbsolute(path) ||
    path.split(/[\\/]/).some((s) => s === '..' || s === '.') ||
    path.includes('\\')
  )
    throw new Error(`C4: unsafe path ${path}`);
  const realRoot = await realpath(root);
  const target = join(realRoot, '.skaro', path);
  let existing = target;
  while (true) {
    try {
      const actual = await realpath(existing);
      const rel = relative(realRoot, actual);
      if (rel.startsWith('..') || isAbsolute(rel))
        throw new Error(`C4: path escapes project ${path}`);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
  return target;
}

export async function writeC4File(root: string, path: string, body: string): Promise<void> {
  const target = await c4Path(root, path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, body, { flag: 'wx' });
    await replaceFile(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}
