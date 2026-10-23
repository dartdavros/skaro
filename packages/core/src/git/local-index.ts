import { git } from './command.ts';

export const splitPaths = (value: string) => value.split('\0').filter(Boolean);
export const overlapsPath = (a: string, b: string): boolean => {
  if (process.platform === 'win32') {
    a = a.toLowerCase();
    b = b.toLowerCase();
  }
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
};

/** Replace only these entries in a PRIVATE index, including deletions and directory changes. */
export async function restoreIndexPaths(
  repo: string,
  index: string,
  tree: string,
  paths: string[],
): Promise<void> {
  const env = { GIT_INDEX_FILE: index };
  const selected = (path: string) => paths.some((scope) => overlapsPath(scope, path));
  const current = splitPaths((await git(repo, ['ls-files', '-z'], { env })).stdout).filter(
    selected,
  );
  const entries = splitPaths((await git(repo, ['ls-tree', '-r', '-z', tree])).stdout)
    .map((entry) => {
      const tab = entry.indexOf('\t');
      const [mode, , oid] = entry.slice(0, tab).split(' ');
      return { mode: mode!, oid: oid!, path: entry.slice(tab + 1) };
    })
    .filter((entry) => selected(entry.path));
  if (current.length)
    await git(repo, ['--literal-pathspecs', 'update-index', '--force-remove', '--', ...current], {
      env,
    });
  if (entries.length)
    await git(repo, ['update-index', '-z', '--index-info'], {
      env,
      input: entries.map(({ mode, oid, path }) => `${mode} ${oid}\t${path}\0`).join(''),
    });
}
