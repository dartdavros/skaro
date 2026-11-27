import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { git, gitStream } from '@skaro/core';

/** Preserve the existing JSON fingerprint byte-for-byte across arbitrary stream boundaries. */
export function checkoutDiffHash() {
  const hash = createHash('sha256').update('{"diff":"');
  return {
    write: (chunk: string) => {
      hash.update(JSON.stringify(chunk).slice(1, -1));
    },
    finish: (files: string[][]) =>
      hash.update('","files":').update(JSON.stringify(files)).update('}').digest('hex'),
  };
}

/** Includes staged, unstaged and untracked code, using the task's real Git checkout. */
export async function checkoutChangeHash(
  root: string,
  baseHead: string,
  head?: string,
): Promise<string> {
  const hash = checkoutDiffHash();
  await gitStream(
    root,
    ['diff', '--binary', baseHead, ...(head ? [head] : []), '--', '.', ':(exclude).skaro'],
    hash.write,
  );
  const others = head
    ? { stdout: '' }
    : await git(root, [
        'ls-files',
        '--others',
        '--exclude-standard',
        '-z',
        '--',
        '.',
        ':(exclude).skaro',
      ]);
  const files = await Promise.all(
    others.stdout
      .split('\0')
      .filter(Boolean)
      .sort()
      .map(async (path) => {
        const fileHash = createHash('sha256');
        for await (const chunk of createReadStream(join(root, path), { encoding: 'base64' }))
          fileHash.update(chunk);
        return [path, fileHash.digest('hex')];
      }),
  );
  return hash.finish(files);
}
