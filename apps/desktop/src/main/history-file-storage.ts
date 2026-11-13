import { constants, type Stats } from 'node:fs';
import { chmod, link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { historyDigest, type HistoryEntry } from './history-file-metadata';
import { publicationAction } from './history-publication-state';
import { HistoryPathGuard } from './history-path-guard';

export async function historyDirectory(dataDir: string, project: string): Promise<string> {
  if (!/^[a-zA-Z0-9_-]+$/.test(project)) throw new Error('Invalid project identity');
  let path = await realpath(dataDir);
  const scope = await HistoryPathGuard.capture(path);
  for (const part of ['history-files', project]) {
    path = join(path, part);
    await scope.leaf(path);
    await mkdir(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    await scope.directory(path, true);
  }
  return path;
}

export async function exportInfo(path: string, entry: HistoryEntry) {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (!info) return { state: 'missing' as const, bytes: 0 };
  if (!info.isFile() || info.isSymbolicLink() || info.size !== entry.bytes)
    return { state: 'changed' as const, bytes: info.size, info };
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const current = await handle.stat();
    if (current.ino !== info.ino || current.dev !== info.dev || current.size !== entry.bytes)
      return { state: 'changed' as const, bytes: current.size, info: current };
    const exact = historyDigest(await handle.readFile()) === entry.digest;
    return {
      state: exact ? ('exact' as const) : ('changed' as const),
      bytes: current.size,
      info: current,
    };
  } finally {
    await handle.close();
  }
}

/** Revalidate both leaf and every remembered ancestor after hashing and before each effect. */
async function effectBoundary(
  path: string,
  expected: Stats,
  links: number,
  scope: HistoryPathGuard,
) {
  const current = await lstat(path);
  if (
    !current.isFile() ||
    current.isSymbolicLink() ||
    current.ino !== expected.ino ||
    current.dev !== expected.dev ||
    current.mtimeMs !== expected.mtimeMs ||
    current.size !== expected.size ||
    current.nlink !== links
  )
    throw new Error('Historical export changed or has unknown aliases');
  await scope.leaf(path);
}

/** Delete a single verified, unaliased owned file. Never chmod a foreign hard-link alias. */
export async function removeExport(
  path: string,
  entry: HistoryEntry,
  beforeEffect: () => void = () => undefined,
  operationScope?: HistoryPathGuard,
): Promise<number> {
  const scope = operationScope ?? (await HistoryPathGuard.capture(dirname(path)));
  await scope.leaf(path);
  const checked = await exportInfo(path, entry);
  if (checked.state === 'missing') {
    await scope.leaf(path);
    return 0;
  }
  if (checked.state !== 'exact') throw new Error('Historical export identity changed');
  await effectBoundary(path, checked.info, 1, scope);
  // Windows readonly deletion requires clearing the attribute, only after proving one owned alias.
  beforeEffect();
  await chmod(path, 0o600);
  await effectBoundary(path, checked.info, 1, scope);
  beforeEffect();
  await unlink(path);
  await scope.leaf(path);
  return checked.bytes;
}

/** The two known aliases are one fully written object, never an arbitrary hard-linked user file. */
async function finishPublication(
  dir: string,
  entry: HistoryEntry,
  scope: HistoryPathGuard,
): Promise<void> {
  const target = join(dir, entry.name),
    temporary = join(dir, entry.pending!);
  await scope.leaf(target);
  const [published, pending] = await Promise.all([
    exportInfo(target, entry),
    exportInfo(temporary, entry),
  ]);
  if (published.state !== 'exact') throw new Error('Published historical export changed');
  if (pending.state !== 'exact') {
    await scope.leaf(target);
    return;
  }
  const a = published.info,
    b = pending.info;
  if (a.ino !== b.ino || a.dev !== b.dev || a.nlink !== 2 || b.nlink !== 2) {
    await scope.leaf(target);
    return;
  }
  // No OS handoff yet. Only the two verified owned aliases may have their readonly flag changed.
  await effectBoundary(target, a, 2, scope);
  await effectBoundary(temporary, b, 2, scope);
  await chmod(temporary, 0o600);
  await effectBoundary(target, a, 2, scope);
  await effectBoundary(temporary, b, 2, scope);
  await unlink(temporary);
  await effectBoundary(target, a, 1, scope);
  await chmod(target, 0o400);
  await scope.leaf(target);
}

/** Journal already exists. A hard-link publishes the synced file atomically without replacement. */
export async function publishExport(
  dir: string,
  entry: HistoryEntry,
  bytes: Buffer,
): Promise<boolean> {
  if (!entry.pending || bytes.length !== entry.bytes || historyDigest(bytes) !== entry.digest)
    throw new Error('Historical export publication identity is invalid');
  const scope = await HistoryPathGuard.capture(dir);
  const target = join(dir, entry.name),
    temporary = join(dir, entry.pending);
  const targetInfo = await exportInfo(target, entry);
  let pending = await exportInfo(temporary, entry);
  await scope.leaf(target);
  const action = publicationAction(targetInfo.state, pending.state);
  if (action === 'retain') return false;
  if (action === 'ready') {
    await finishPublication(dir, entry, scope);
    return true;
  }
  if (action === 'write') {
    await scope.leaf(temporary);
    const handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o400,
    );
    try {
      await effectBoundary(temporary, await handle.stat(), 1, scope);
      await handle.writeFile(bytes);
      await scope.leaf(temporary);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await scope.leaf(temporary);
    pending = await exportInfo(temporary, entry);
  }
  if (pending.state !== 'exact') {
    await scope.leaf(temporary);
    return false;
  }
  await effectBoundary(temporary, pending.info, 1, scope);
  await scope.leaf(target);
  await link(temporary, target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  await scope.leaf(target);
  if ((await exportInfo(target, entry)).state !== 'exact') return false;
  await finishPublication(dir, entry, scope);
  return true;
}
