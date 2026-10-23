import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from './command.ts';
import { captureFiles, sameImage, type FileImage } from './merge-files.ts';
import { overlapsPath, restoreIndexPaths, splitPaths } from './local-index.ts';
import { serializedMerge } from './merge-queue.ts';

export interface LocalChangesSnapshot {
  id: string;
  base: string;
  paths: string[];
  staged: string;
  working: string;
}
interface SavedSnapshot extends LocalChangesSnapshot {
  entries: string;
  files: [string, FileImage][];
}
export interface LocalChangesResolution {
  snapshot: LocalChangesSnapshot;
  index: string;
  working: string;
  worktree: string;
}
export class LocalChangesChangedError extends Error {
  readonly paths: string[];
  constructor(paths: string[] = []) {
    super('Local changes changed during resolution; Skaro must prepare them again.');
    this.paths = paths;
  }
}

/** Retry identity includes local edits, not only the branch tip and accepted task result. */
export async function localChangesFingerprint(repo: string): Promise<string> {
  const [status, staged, working] = await Promise.all([
    git(repo, ['status', '--porcelain=v1', '-z']),
    git(repo, ['diff', '--cached', '--binary', '--no-ext-diff']),
    git(repo, ['diff', '--binary', '--no-ext-diff']),
  ]);
  return createHash('sha256')
    .update(JSON.stringify([status.stdout, staged.stdout, working.stdout]))
    .digest('hex');
}
async function storage(repo: string) {
  return join(
    (await git(repo, ['rev-parse', '--absolute-git-dir'])).stdout.trim(),
    'skaro-local-changes',
  );
}
async function indexEntries(repo: string, paths: string[], index?: string) {
  return splitPaths(
    (
      await git(
        repo,
        ['ls-files', '--stage', '-z'],
        index ? { env: { GIT_INDEX_FILE: index } } : {},
      )
    ).stdout,
  )
    .filter((entry) =>
      paths.some((path) => overlapsPath(path, entry.slice(entry.indexOf('\t') + 1))),
    )
    .sort()
    .join('\0');
}
export async function assertLocalChanges(
  repo: string,
  snapshot: LocalChangesSnapshot,
): Promise<void> {
  const saved: SavedSnapshot = JSON.parse(
    await readFile(join(await storage(repo), snapshot.id, 'snapshot.json'), 'utf8'),
  );
  if (
    saved.base !== (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim() ||
    saved.entries !== (await indexEntries(repo, saved.paths))
  )
    throw new LocalChangesChangedError();
  const current = await captureFiles(repo, saved.paths);
  if (saved.files.some(([path, image]) => !sameImage(image, current.get(path)!)))
    throw new LocalChangesChangedError();
  // Detect new children of a directory that appeared while the resolver was working.
  const others = splitPaths((await git(repo, ['ls-files', '--others', '-z'])).stdout);
  if (
    others.some(
      (path) => saved.paths.some((scope) => overlapsPath(scope, path)) && !current.has(path),
    )
  )
    throw new LocalChangesChangedError();
}

/** Immutable, scoped snapshots. Never stash, clean, or write the owner's index/worktree. */
export function preserveLocalChanges(
  repo: string,
  base: string,
  paths: string[],
): Promise<LocalChangesSnapshot> {
  return serializedMerge(repo, async () => {
    const candidates = splitPaths(
      (await git(repo, ['ls-files', '--cached', '--others', '-z'])).stdout,
    );
    paths = [
      ...new Set([
        ...paths,
        ...candidates.filter((path) => paths.some((scope) => overlapsPath(scope, path))),
      ]),
    ].sort();
    const files = [...(await captureFiles(repo, paths))];
    const entries = await indexEntries(repo, paths);
    if (entries.split('\0').some((entry) => entry && !entry.split('\t')[0]!.endsWith(' 0')))
      throw new Error('The main index has an unfinished merge; its entries have been left intact.');
    const id = createHash('sha256')
      .update(JSON.stringify([base, paths, entries, files]))
      .digest('hex');
    const dir = join(await storage(repo), id);
    try {
      const saved: SavedSnapshot = JSON.parse(await readFile(join(dir, 'snapshot.json'), 'utf8'));
      await assertLocalChanges(repo, saved);
      return { id, base, paths, staged: saved.staged, working: saved.working };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await mkdir(dir, { recursive: true });
    const index = join(dir, `index-${randomUUID()}`);
    const env = { GIT_INDEX_FILE: index };
    const sourceIndex = (
      await git(repo, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])
    ).stdout.trim();
    await copyFile(sourceIndex, join(dir, 'original-index'));
    if (entries !== (await indexEntries(repo, paths, join(dir, 'original-index'))))
      throw new LocalChangesChangedError();
    await copyFile(join(dir, 'original-index'), index);
    const originalTree = (await git(repo, ['write-tree'], { env })).stdout.trim();
    await git(repo, ['read-tree', base], { env });
    await restoreIndexPaths(repo, index, originalTree, paths);
    const commit = async (parent: string, label: string) => {
      const tree = (await git(repo, ['write-tree'], { env })).stdout.trim();
      return (
        await git(repo, [
          'commit-tree',
          tree,
          '-p',
          parent,
          '-m',
          `:card_index: chore: preserve local ${label}`,
        ])
      ).stdout.trim();
    };
    const staged = await commit(base, 'index');
    // First remove all scoped entries, then add the actual files (file/directory replacements).
    const scoped = splitPaths((await git(repo, ['ls-files', '-z'], { env })).stdout).filter(
      (path) => paths.some((scope) => overlapsPath(scope, path)),
    );
    if (scoped.length)
      await git(repo, ['--literal-pathspecs', 'update-index', '--force-remove', '--', ...scoped], {
        env,
      });
    for (const [path, file] of files) {
      if (file.kind !== 'file' && file.kind !== 'symlink') continue;
      const input =
        file.kind === 'file' ? Buffer.from(file.data, 'base64') : Buffer.from(file.target);
      const oid = (
        await git(
          repo,
          ['hash-object', '-w', ...(file.kind === 'file' ? [`--path=${path}`] : []), '--stdin'],
          { input },
        )
      ).stdout.trim();
      const previousMode = entries
        .split('\0')
        .find((entry) => entry.endsWith(`\t${path}`))
        ?.split(' ')[0];
      const mode =
        file.kind === 'symlink'
          ? '120000'
          : process.platform === 'win32'
            ? (previousMode ?? '100644')
            : file.mode & 0o111
              ? '100755'
              : '100644';
      await git(repo, ['update-index', '--add', '--cacheinfo', mode, oid, path], { env });
    }
    const working = await commit(staged, 'working files');
    const snapshot: SavedSnapshot = { id, base, paths, staged, working, files, entries };
    await git(repo, ['update-ref', `refs/skaro/local-changes/${id}`, working]);
    const journal = join(dir, `snapshot-${randomUUID()}.json`);
    await writeFile(journal, JSON.stringify(snapshot), { flag: 'wx' });
    await rename(journal, join(dir, 'snapshot.json'));
    await rm(index, { force: true });
    await assertLocalChanges(repo, snapshot);
    return { id, base, paths, staged, working };
  });
}
