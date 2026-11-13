import { readNpmArchive } from './managed-npm-archive-reader';
import { npmExpansionFits } from './managed-npm-tar';

export {
  NPM_INSTALL_BYTE_LIMIT,
  NPM_INSTALL_FILE_LIMIT,
  npmArchivePath,
  npmTarHeader,
  npmExpansionFits,
} from './managed-npm-tar';

/** Exact historical component-depth/bin/layout counters for already-produced failure evidence. */
export async function npmLegacyArchiveExpansion(path: string, copies: number, installNodes = 0) {
  npmExpansionFits(0, 0, copies, 0, installNodes);
  const archive = await readNpmArchive(path);
  return npmExpansionFits(archive.bytes, archive.legacyFiles, copies, 0, installNodes);
}

/** Current npm layout bound; pnpm instead combines this payload inventory with its full lock graph. */
export async function npmArchiveExpansion(path: string, copies: number, installNodes = 0) {
  npmExpansionFits(0, 0, copies, 0, installNodes);
  const archive = await readNpmArchive(path);
  return npmExpansionFits(
    archive.bytes,
    archive.nodes.length + archive.bins.length * 4,
    copies,
    0,
    installNodes,
  );
}
