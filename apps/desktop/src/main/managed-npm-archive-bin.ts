import {
  npmArchivePath,
  NPM_INSTALL_FILE_LIMIT,
  unsupportedNpmArchive as unsupported,
} from './managed-npm-tar';

export interface NpmArchiveBin {
  command: string;
  target: string;
}
/** Validated manifest facts, never execution authority or a worker-supplied hasBin flag. */
export function npmArchiveBins(bytes: Buffer): NpmArchiveBin[] {
  const pkg = JSON.parse(bytes.toString('utf8')) as {
    name?: unknown;
    bin?: unknown;
    directories?: { bin?: unknown };
  };
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg) || pkg.directories?.bin !== undefined)
    unsupported();
  if (pkg.bin === undefined) return [];
  if (
    typeof pkg.bin === 'string' &&
    (typeof pkg.name !== 'string' || !/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(pkg.name))
  )
    unsupported();
  const value =
    typeof pkg.bin === 'string' ? { [(pkg.name as string).split('/').at(-1)!]: pkg.bin } : pkg.bin;
  if (!value || typeof value !== 'object' || Array.isArray(value)) unsupported();
  const entries = Object.entries(value),
    commands = new Set<string>();
  if (entries.length > NPM_INSTALL_FILE_LIMIT) unsupported();
  return entries.map(([command, raw]) => {
    if (
      !/^[a-zA-Z0-9._-]{1,100}$/.test(command) ||
      /[. ]$/.test(command) ||
      /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(command) ||
      typeof raw !== 'string' ||
      !raw ||
      commands.has(command.toLowerCase())
    )
      unsupported();
    const target = raw.replace(/^\.\//, '');
    npmArchivePath(`package/${target}`, 48);
    commands.add(command.toLowerCase());
    return { command, target };
  });
}
