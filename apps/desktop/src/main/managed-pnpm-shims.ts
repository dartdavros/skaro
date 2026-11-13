import { realpath } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';
import { pnpmPrivatePath } from './managed-pnpm-layout';
import { assertPnpmNodePaths } from './managed-pnpm-node-paths';

/** Known pnpm cmd-shim relative references, not a shell evaluator. Unknown layouts fail closed. */
export function pnpmShimTargets(root: string, shim: string, text: string) {
  if (Buffer.byteLength(text) > 64 * 1024 || text.includes('\0'))
    throw new Error('managed_pnpm_shim_unsupported');
  const refs = [...text.matchAll(/(?:\$basedir|%~dp0|\$PSScriptRoot)([\\/][^"'\s`;$]*)/g)].map(
    (match) =>
      pnpmPrivatePath(
        root,
        resolve(
          dirname(shim),
          match[1]!
            .replaceAll('\\', sep)
            .replaceAll('/', sep)
            .replace(/^[\\/]/, ''),
        ),
      ),
  );
  assertPnpmNodePaths(root, shim, text);
  // Keep the existing absolute Windows reference fence, without mistaking NODE_PATH's
  // POSIX colon separator ("modules:/next") for a drive beginning at its final letter.
  for (const match of text.matchAll(/(?<![\w/\\.-])[A-Za-z]:[\\/][^";\r\n]+/g))
    pnpmPrivatePath(root, match[0]);
  const targets = [...new Set(refs.filter((path) => !/^node(?:\.exe)?$/i.test(basename(path))))];
  if (!targets.length) throw new Error('managed_pnpm_shim_private_target_missing');
  return targets;
}
export async function verifyPnpmShim(root: string, shim: string, bytes: Buffer) {
  const targets: string[] = [];
  for (const target of pnpmShimTargets(root, shim, bytes.toString('utf8')))
    targets.push(pnpmPrivatePath(root, await realpath(target)));
  return [...new Set(targets)];
}
