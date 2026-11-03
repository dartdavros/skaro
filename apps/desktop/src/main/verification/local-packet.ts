import assert from 'node:assert/strict';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

/** Read an immutable actual verification artifact, confined to this application's userData. */
export async function readLocalPacket(
  data: string,
  path: string,
  maxBytes = 262_144,
): Promise<unknown> {
  const root = await realpath(join(data, 'verification'));
  const actual = await realpath(path);
  const rel = relative(root, actual);
  const before = await lstat(path);
  assert(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
  assert(
    before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.size <= maxBytes,
  );
  const bytes = await readFile(actual);
  const after = await lstat(path);
  assert.equal(bytes.length, before.size);
  for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'] as const)
    assert.equal(after[key], before[key]);
  return JSON.parse(bytes.toString('utf8'));
}
