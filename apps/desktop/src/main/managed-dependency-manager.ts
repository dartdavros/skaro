import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { readCacheFile } from './managed-cache-files';
import { UnsupportedDependencyCache } from './managed-dependency-provenance';
import { PNPM_VERSION } from './managed-pnpm-lock';

/** Host-selected dispatch only. Adapters revalidate complete provenance after admission. */
export async function managedDependencyManager(cwd: string): Promise<'npm' | 'pnpm'> {
  const bytes = (await readCacheFile(cwd, join(cwd, 'package.json'), 16 * 1024 ** 2)).data;
  const pkg = JSON.parse(bytes.toString()) as { packageManager?: unknown };
  const exists = async (name: string) => {
    try {
      await lstat(join(cwd, name));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  };
  const [npm, pnpm] = await Promise.all([exists('package-lock.json'), exists('pnpm-lock.yaml')]);
  if (pnpm && !npm && pkg.packageManager === `pnpm@${PNPM_VERSION}`) return 'pnpm';
  if (
    npm &&
    !pnpm &&
    (pkg.packageManager === undefined ||
      (typeof pkg.packageManager === 'string' && /^npm@\d/.test(pkg.packageManager)))
  )
    return 'npm';
  throw new UnsupportedDependencyCache('managed_dependencies_unsupported_or_ambiguous_manager');
}
