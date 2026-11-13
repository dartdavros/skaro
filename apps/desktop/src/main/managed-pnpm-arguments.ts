import { isAbsolute, join, relative } from 'node:path';

/** Pure argv contract, shared by supervised execution and the read-only pinned-SDK diagnostic. */
export function pnpmCommandArguments(
  cli: string,
  action: 'fetch' | 'install',
  work: string,
  home: string,
  store: string,
  modules: string,
) {
  // pnpm 10.11 joins modules-dir onto the project root; absolute Windows paths embed another C:.
  const modulesDirectory = relative(work, modules);
  if (!modulesDirectory || isAbsolute(modulesDirectory))
    throw new Error('managed_pnpm_modules_directory_unsupported');
  return [
    '--max-old-space-size=512',
    '--max-semi-space-size=16',
    cli,
    action,
    '--offline',
    '--frozen-lockfile',
    '--ignore-scripts',
    '--ignore-pnpmfile',
    '--ignore-workspace',
    '--package-import-method=copy',
    '--registry=https://registry.npmjs.org/',
    '--reporter=ndjson',
    `--store-dir=${store}`,
    `--modules-dir=${modulesDirectory}`,
    `--virtual-store-dir=${join(modules, '.pnpm')}`,
    `--lockfile-dir=${work}`,
    `--config.userconfig=${join(home, 'user.npmrc')}`,
    `--config.globalconfig=${join(home, 'global.npmrc')}`,
    `--config.cache-dir=${join(home, 'cache')}`,
    `--config.state-dir=${join(home, 'state')}`,
    `--config.global-dir=${join(home, 'global')}`,
    `--config.global-bin-dir=${join(home, 'bin')}`,
    '--config.side-effects-cache=false',
    '--config.manage-package-manager-versions=false',
    '--config.package-manager-strict=true',
    '--config.package-manager-strict-version=true',
    '--config.node-linker=isolated',
    '--config.symlink=true',
    '--config.hoist=false',
    // The --config. spelling preserves numeric values as STRINGS in pnpm 10.11 getConfig.
    '--fetch-retries=0',
    '--network-concurrency=1',
    '--child-concurrency=1',
    // Neutral selectors include BOTH production and development dependencies.
    '--config.optional=true',
  ];
}
