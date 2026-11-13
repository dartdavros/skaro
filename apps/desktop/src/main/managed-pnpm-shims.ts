import { realpath } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';
import { pnpmPrivatePath } from './managed-pnpm-layout';

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
  // NODE_PATH can contain nonexistent search dirs, but must never name source/shared paths.
  for (const match of text.matchAll(/[A-Za-z]:[\\/][^";\r\n]+/g)) pnpmPrivatePath(root, match[0]);
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
