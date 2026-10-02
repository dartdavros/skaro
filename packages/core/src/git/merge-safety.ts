import { git } from './command.ts';

const paths = (output: string) => output.split('\0').filter(Boolean);
const overlaps = (first: string, second: string) => {
  const a = process.platform === 'win32' ? first.toLowerCase() : first;
  const b = process.platform === 'win32' ? second.toLowerCase() : second;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
};

/** Both sides of staging matter, even when a working file was restored to HEAD. */
export async function localMergeObstacles(
  repo: string,
  before: string,
  target: string,
  managed: readonly string[] = [],
): Promise<string[]> {
  const changed = paths(
    (await git(repo, ['diff', '--name-only', '--no-renames', '-z', before, target])).stdout,
  ).filter((path) => !managed.includes(path));
  if (!changed.length) return [];
  const outputs = await Promise.all([
    git(repo, ['diff', '--name-only', '--no-renames', '-z']),
    git(repo, ['diff', '--cached', '--name-only', '--no-renames', '-z']),
    git(repo, ['ls-files', '--others', '-z']),
  ]);
  return [...new Set(outputs.flatMap((out) => paths(out.stdout)))]
    .filter((path) => changed.some((affected) => overlaps(path, affected)))
    .sort();
}
