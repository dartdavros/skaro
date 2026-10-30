import { promises as fs } from 'original-fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Platform } from '@skaro/core';

/** Copy the physical application, including app.asar, without Electron's archive translation. */
export async function backupApplication(
  updatesDir: string,
  version: string,
  executable: string,
  platform: Platform,
): Promise<string> {
  const source = resolve(
    platform.os === 'linux'
      ? (process.env['APPIMAGE'] ?? executable)
      : platform.os === 'darwin'
        ? join(dirname(executable), '../..')
        : dirname(executable),
  );
  const directory = resolve(updatesDir, 'previous', `${version}-${randomUUID()}`);
  const destination = join(directory, basename(source));
  const insideSource = relative(source, directory);
  const insideUpdates = relative(resolve(updatesDir), directory);
  if (
    (!insideSource.startsWith('..') && !isAbsolute(insideSource)) ||
    insideUpdates.startsWith('..') ||
    isAbsolute(insideUpdates)
  )
    throw new Error('Unsafe update backup path');
  await fs.mkdir(dirname(directory), { recursive: true });
  // Exclusive ownership: failure cleanup may remove only this attempt's new directory.
  await fs.mkdir(directory);
  try {
    await fs.cp(source, destination, { recursive: true, errorOnExist: true, force: false });
    return destination;
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch((cleanupError) => {
      console.error('[updates] Could not remove incomplete application backup', cleanupError);
    });
    throw new Error(
      `Could not create application backup: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/** After a confirmed update only its own copy of the previous application stays for recovery. */
export async function removeOlderBackups(updatesDir: string, keep?: string): Promise<void> {
  const root = resolve(updatesDir, 'previous');
  const kept = keep ? relative(root, resolve(keep)).split(sep)[0] : undefined;
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const name of entries)
    if (name !== kept) await fs.rm(join(root, name), { recursive: true, force: true });
}
