import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { hashFile } from './inputs.ts';

export async function verifyEvidenceArtifact(
  root: string,
  artifact: { path: string; sha256: string; bytes: number },
  signal: AbortSignal,
) {
  const directory = await realpath(root);
  const target = resolve(artifact.path);
  const inside = (path: string) => {
    const rel = relative(directory, path);
    return !!rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
  };
  if (!inside(target))
    throw new Error('Evidence artifact is outside the private artifact directory');
  const stat = await lstat(target);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size !== artifact.bytes ||
    !inside(await realpath(target))
  )
    throw new Error('Evidence artifact is not an unchanged private regular file');
  if ((await hashFile(target, signal)) !== artifact.sha256)
    throw new Error('Evidence artifact bytes changed');
}
