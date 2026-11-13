import dockerignore from '@balena/dockerignore';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { managedCacheCommand } from './managed-cache-command';
import { canonicalCachePath, hasCacheControls, readCacheFile } from './managed-cache-files';
import {
  managedBuildHash,
  MANAGED_BUILD_BYTE_LIMIT,
  MANAGED_BUILD_NODE_LIMIT,
  unsupportedManagedBuild,
} from './managed-build-recipe';

export function secretBuildPath(path: string): boolean {
  return (
    path
      .split('/')
      .some((part) =>
        /^(?:\.git|\.skaro|node_modules|\.env(?:\..*)?|\.npmrc|\.yarnrc(?:\.yml)?|\.pypirc|\.netrc|\.ssh|\.aws|credentials(?:\..*)?|id_rsa|id_ed25519)$/i.test(
          part,
        ),
      ) || /\.(?:pem|key|p12|pfx|sqlite3?|db)$/i.test(path)
  );
}
/** Strict tracked example-template subset, never a blanket .env.* or secret-scanner guarantee. */
export function reviewedBuildTemplate(path: string, data: Buffer): boolean {
  if (path !== '.env.example' || data.length > 16 * 1024) return false;
  const keys = new Set<string>();
  for (const line of data.toString('utf8').trimEnd().split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Z_][A-Z_0-9]*)=([\x20-\x7e]{0,256})$/.exec(line);
    if (!match || keys.has(match[1]!) || keys.size >= 100) return false;
    const key = match[1]!,
      value = match[2]!;
    if (/[$`]/.test(value) || /:\/\/[^/]*@/.test(value)) return false;
    if (
      /PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|(?:API|PRIVATE|ACCESS)_KEY/.test(key) &&
      !['', 'change-me', 'changeme', 'replace-me', 'placeholder', 'example'].includes(value)
    )
      return false;
    keys.add(key);
  }
  return keys.size > 0;
}
export interface ManagedBuildFile {
  path: string;
  mode: number;
  bytes: number;
  digest: string;
}
export const managedContextDigest = (entries: ManagedBuildFile[]) =>
  managedBuildHash(JSON.stringify(entries));
export const managedContextIgnore = (text: string) =>
  dockerignore({ ignorecase: false }).add(text.replace(/^\uFEFF/, ''));

/** Read the actual Docker context, not the repository root or a generated substitute. */
export async function inspectManagedContext(cwd: string) {
  const env = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0' };
  if (
    await managedCacheCommand(
      'git',
      [
        '-c',
        'core.fsmonitor=false',
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=no',
        '--',
        '.',
      ],
      { cwd, env, maxOutput: 8 * 1024 ** 2 },
    )
  )
    unsupportedManagedBuild('dirty_selected_context');
  const index = await managedCacheCommand(
    'git',
    ['-c', 'core.fsmonitor=false', 'ls-files', '--stage', '-z', '--', '.'],
    { cwd, env, maxOutput: 8 * 1024 ** 2 },
  );
  const tracked = new Set<string>();
  for (const item of index.split('\0').filter(Boolean)) {
    const match = /^100(?:644|755) [a-f0-9]+ 0\t([\s\S]+)$/.exec(item);
    if (!match) unsupportedManagedBuild('nonregular_index_entry');
    tracked.add(match[1]!);
  }
  let ignorePath: string | undefined;
  for (const path of ['Dockerfile.dockerignore', '.dockerignore']) {
    try {
      await lstat(join(cwd, path));
      ignorePath = path;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const ignoreText = ignorePath
    ? (await readCacheFile(cwd, join(cwd, ignorePath), 128 * 1024)).data.toString('utf8')
    : '';
  const ignore = managedContextIgnore(ignoreText);
  const entries: ManagedBuildFile[] = [],
    nodes = new Set<string>();
  let bytes = 0,
    visited = 0;
  async function walk(directory: string): Promise<void> {
    for (const name of (await readdir(join(cwd, directory))).sort()) {
      const path = directory ? `${directory}/${name}` : name;
      if (
        ++visited > 50000 ||
        /[\\:]/.test(path) ||
        hasCacheControls(path) ||
        path.split('/').some((part) => ['', '.', '..'].includes(part))
      )
        unsupportedManagedBuild('source_expansion');
      const absolute = join(cwd, path),
        info = await lstat(absolute);
      const excluded = ignore.ignores(path);
      if (info.isDirectory()) {
        // Do not follow redirected directories, including ignored ones. Negation may reinclude descendants.
        await canonicalCachePath(cwd, absolute);
        if (name === '.git' && excluded) continue;
        await walk(path);
      } else if (!excluded || path === 'Dockerfile' || path === ignorePath) {
        if (!tracked.has(path) || !info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
          unsupportedManagedBuild('untracked_or_nonregular_context');
        const { data, mode } = await readCacheFile(cwd, absolute, 64 * 1024 ** 2);
        if (secretBuildPath(path) && !reviewedBuildTemplate(path, data))
          unsupportedManagedBuild('secret_source');
        bytes += data.length;
        for (let count = 1; count <= path.split('/').length; count++)
          nodes.add(path.split('/').slice(0, count).join('/'));
        if (bytes > MANAGED_BUILD_BYTE_LIMIT || nodes.size > MANAGED_BUILD_NODE_LIMIT)
          unsupportedManagedBuild('source_expansion');
        entries.push({ path, mode, bytes: data.length, digest: managedBuildHash(data) });
      }
    }
  }
  await walk('');
  entries.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  if (!entries.some((entry) => entry.path === 'Dockerfile'))
    unsupportedManagedBuild('no_dockerfile');
  return {
    entries,
    files: entries.map((entry) => entry.path),
    bytes,
    nodes: nodes.size,
    sourceDigest: managedContextDigest(entries),
  };
}
