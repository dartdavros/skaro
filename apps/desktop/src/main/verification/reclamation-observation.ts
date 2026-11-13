import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readlink, realpath, statfs } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { freemem } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { git, type AppDb } from '@skaro/core';
import { resourceInventory } from './resource-workflow-observation';

const execute = promisify(execFile);
const exact = { env: { GIT_NO_REPLACE_OBJECTS: '1' } };

async function digest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

/** Hash real source/history bytes; never manufacture files or expose their contents in evidence. */
export async function sourceFingerprint(root: string) {
  const listed = await git(
    root,
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    exact,
  );
  const files = [...new Set(listed.stdout.split('\0').filter(Boolean))].sort();
  assert(files.length <= 20_000, 'Refuse an unexpectedly large verification scope');
  const hash = createHash('sha256');
  let bytes = 0;
  for (const file of files) {
    const path = resolve(root, file);
    const rel = relative(root, path);
    assert(rel && !rel.startsWith('..'), 'Source path escaped the registered checkout');
    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (!info) {
      hash.update(JSON.stringify([file, 'absent']));
      continue;
    }
    if (info.isSymbolicLink()) {
      hash.update(JSON.stringify([file, 'symlink', await readlink(path)]));
      continue;
    }
    assert(info.isFile(), 'A source entry is not a regular file');
    assert.equal(resolve(await realpath(path)), path, 'A source ancestor is not canonical');
    bytes += info.size;
    hash.update(JSON.stringify([file, info.size, await digest(path)]));
  }
  return { files: files.length, bytes, sha256: hash.digest('hex') };
}

export async function protectedFingerprint(
  db: AppDb,
  projectId: string,
  root: string,
  data: string,
  excludedTasks: readonly string[] = ['T-005'],
) {
  const paths = new Set([root]);
  for (const row of db.resources.list(projectId)) {
    if (
      row.kind === 'worktree' &&
      row.identity.path &&
      row.ownership === 'registered' &&
      row.state !== 'released' &&
      !(row.owner.kind === 'task' && excludedTasks.includes(row.owner.id))
    )
      paths.add(row.identity.path);
  }
  const sources = [];
  for (const path of [...paths].sort()) {
    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    assert(
      info?.isDirectory() && !info.isSymbolicLink(),
      'A protected checkout must remain present',
    );
    sources.push({ path, source: await sourceFingerprint(path) });
  }
  const histories = [];
  for (const run of db.listRuns(projectId)) {
    const path = resolve(data, run.logPath);
    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    histories.push({
      id: run.id,
      task: run.taskId,
      path,
      sha256: info?.isFile() ? await digest(path) : null,
    });
  }
  return {
    sources,
    histories,
    branches: (
      await git(root, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'], exact)
    ).stdout,
    head: (await git(root, ['rev-parse', 'HEAD'], exact)).stdout.trim(),
  };
}

/** Logical source bytes, Docker accounting and actual host free space are deliberately separate. */
export async function reclamationInventory(root: string, data: string, target: string) {
  const inventory = await resourceInventory(root);
  const [networks, usage, host, profile] = await Promise.all([
    execute('docker', ['network', 'ls', '-q', '--no-trunc'], {
      windowsHide: true,
      timeout: 20_000,
    }),
    execute('docker', ['system', 'df', '--format', '{{json .}}'], {
      windowsHide: true,
      // Cold daemon accounting over the real image/build cache can exceed 30s.
      timeout: 120_000,
    }),
    statfs(root),
    statfs(data),
  ]);
  const present = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  return {
    ...inventory,
    networks: networks.stdout.trim().split(/\r?\n/).filter(Boolean).sort(),
    dockerUsage: usage.stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown),
    target: present ? await sourceFingerprint(target) : null,
    hostFreeBytes: host.bavail * host.bsize,
    profileFreeBytes: profile.bavail * profile.bsize,
    hostAvailableRamBytes: freemem(),
    verificationProcess: process.memoryUsage(),
  };
}

export function sameDockerObjects(
  before: Awaited<ReturnType<typeof reclamationInventory>>,
  after: Awaited<ReturnType<typeof reclamationInventory>>,
) {
  for (const kind of ['containers', 'volumes', 'images', 'networks'] as const)
    assert.deepEqual(
      after[kind],
      before[kind],
      `${kind} must not change during a source-only history read`,
    );
}
