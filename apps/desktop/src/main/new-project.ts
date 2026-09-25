// "Новый проект" (Projects mockup): connect an existing folder or create an empty one as a git
// repository. Skaro changes no code here; a new folder gets only .skaro/config.yaml.

import { existsSync, statSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { git } from '@skaro/core';
import type { FolderInfo } from '../shared/ipc';

/** What the modal says about a folder before it is connected. */
export async function inspectFolder(path: string): Promise<FolderInfo> {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    return { path, name: basename(path), exists: false, git: false };
  }
  const top = await git(path, ['rev-parse', '--show-toplevel'], { allowFail: true });
  if (top.code !== 0) return { path, name: basename(path), exists: true, git: false };
  const branch = await git(path, ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    allowFail: true,
  });
  return {
    path,
    name: basename(path),
    exists: true,
    git: true,
    ...(branch.code === 0 ? { branch: branch.stdout.trim() } : {}),
  };
}

/** Git for a new folder: `main` with a first commit holding .skaro/config.yaml. */
async function initRepository(path: string): Promise<void> {
  await git(path, ['init', '-q', '-b', 'main']);
  await ensureSkaroConfig(path);
  await git(path, ['add', '-A']);
  // The user's git identity signs the commit; without one, a neutral one does.
  const email = await git(path, ['config', 'user.email'], { allowFail: true });
  const identity = email.stdout.trim()
    ? []
    : ['-c', 'user.name=Skaro', '-c', 'user.email=skaro@localhost'];
  await git(path, [...identity, 'commit', '-q', '--no-verify', '-m', 'Skaro: new project']);
}

/** Creates `<parent>/<name>` as an empty git repository. */
export async function createFolder(parent: string, name: string): Promise<string> {
  const clean = name.trim();
  if (!clean || /[<>:"/\\|?*]/.test(clean) || clean === '.' || clean === '..') {
    throw new Error('invalid project name');
  }
  const path = join(parent, clean);
  if (existsSync(path) && (await readdir(path)).length) throw new Error('folder is not empty');
  await mkdir(path, { recursive: true });
  await initRepository(path);
  return path;
}

async function ensureSkaroConfig(path: string): Promise<void> {
  const config = join(path, '.skaro', 'config.yaml');
  if (existsSync(config)) return;
  await mkdir(join(path, '.skaro'), { recursive: true });
  await writeFile(config, 'base_branch: main\n');
}
