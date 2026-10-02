import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  rename,
  rm,
  rmdir,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type FileImage =
  | { kind: 'missing' | 'directory' }
  | { kind: 'file'; data: string; mode: number }
  | { kind: 'symlink'; target: string };
export type FileImages = Map<string, FileImage>;

export async function fileImage(path: string): Promise<FileImage> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) return { kind: 'symlink', target: await readlink(path) };
    if (stat.isDirectory()) return { kind: 'directory' };
    return { kind: 'file', data: (await readFile(path)).toString('base64'), mode: stat.mode };
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''))
      return { kind: 'missing' };
    throw error;
  }
}

export const sameImage = (a: FileImage, b: FileImage) => JSON.stringify(a) === JSON.stringify(b);

export async function captureFiles(repo: string, paths: readonly string[]): Promise<FileImages> {
  return new Map(
    await Promise.all(
      paths.map(async (path) => [path, await fileImage(join(repo, path))] as const),
    ),
  );
}

export async function putFile(path: string, image: FileImage): Promise<void> {
  const current = await fileImage(path);
  if (image.kind === 'directory') {
    if (current.kind !== 'directory' && current.kind !== 'missing') await rm(path);
    await mkdir(path, { recursive: true });
    return;
  }
  if (image.kind === 'file' && current.kind !== 'directory') {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.skaro-${randomUUID()}`;
    try {
      await writeFile(temporary, Buffer.from(image.data, 'base64'), { flag: 'wx' });
      await chmod(temporary, image.mode);
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    return;
  }
  if (current.kind === 'directory')
    await rmdir(path); // never recursive: preserve other files
  else if (current.kind !== 'missing') await rm(path);
  if (image.kind === 'missing') return;
  await mkdir(dirname(path), { recursive: true });
  if (image.kind === 'symlink') await symlink(image.target, path);
  else if (image.kind === 'file') {
    await writeFile(path, Buffer.from(image.data, 'base64'));
    await chmod(path, image.mode);
  }
}

/** Restore only files published by this operation; a concurrent writer's data is never replaced. */
export async function restoreFiles(
  repo: string,
  before: FileImages,
  after: FileImages,
): Promise<void> {
  const entries = [...before].sort(([a], [b]) => b.length - a.length);
  const blocked = new Set<string>();
  for (const [path, original] of entries) {
    const current = await fileImage(join(repo, path));
    if (sameImage(current, original)) continue;
    const planned = after.get(path)!;
    if (!sameImage(current, planned)) {
      blocked.add(path);
      continue;
    }
    if (original.kind === 'missing') await putFile(join(repo, path), original);
  }
  for (const [path, original] of entries.reverse()) {
    if (blocked.has(path)) continue;
    const current = await fileImage(join(repo, path));
    if (sameImage(current, original)) continue;
    if (!sameImage(current, after.get(path)!)) {
      blocked.add(path);
      continue;
    }
    await putFile(join(repo, path), original);
  }
  if (blocked.size)
    throw new Error(
      `Concurrent edits retained at ${[...blocked].join(', ')}; merge recovery files were preserved`,
    );
}
