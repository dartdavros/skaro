import { git } from '@skaro/core';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { coordinationHash } from '../project-coordinator-request';

/** Hash real product files; normal Skaro task/history metadata is audited separately. */
export async function coordinatorSourceAudit(root: string) {
  return coordinatorSourceAuditWithout(root, []);
}

/** Compare owner work outside the exact source changes authorized for this acceptance. */
export async function coordinatorSourceAuditWithout(root: string, excluded: readonly string[]) {
  const listed = await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  const files = listed.stdout
    .split('\0')
    .filter((path) => path && !path.startsWith('.skaro/') && !excluded.includes(path))
    .sort();
  const hashes = [];
  for (const path of files) {
    try {
      hashes.push([
        path,
        createHash('sha256')
          .update(await readFile(join(root, path)))
          .digest('hex'),
      ]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      hashes.push([path, 'missing']);
    }
  }
  return {
    files: files.length,
    fingerprint: coordinationHash(hashes),
    head: (await git(root, ['rev-parse', 'HEAD'])).stdout.trim(),
  };
}
