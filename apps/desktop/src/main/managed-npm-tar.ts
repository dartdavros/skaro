import { hasCacheControls } from './managed-cache-files';
import { UnsupportedDependencyCache } from './managed-dependency-provenance';

export const NPM_INSTALL_BYTE_LIMIT = 1536 * 1024 ** 2;
// Includes directories and Windows shims: <=256 MiB allocation overhead at <=64 KiB/node.
export const NPM_INSTALL_FILE_LIMIT = 4096;
export function unsupportedNpmArchive(): never {
  throw new UnsupportedDependencyCache('managed_dependencies_unsupported_archive_expansion');
}
function octal(buffer: Buffer) {
  const text = buffer.toString('ascii').replaceAll('\0', '').trim();
  if (!/^[0-7]+$/.test(text)) unsupportedNpmArchive();
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) unsupportedNpmArchive();
  return value;
}
/** Strip exactly one portable root; DefinitelyTyped legitimately uses node/, not package/. */
export function npmArchivePath(path: string, type: number) {
  const parts = path.replace(/\/$/, '').split('/');
  if (
    ![0, 48, 53].includes(type) ||
    !path ||
    /[\\:<>"|?*]/.test(path) ||
    hasCacheControls(path) ||
    (type !== 53 && (parts.length < 2 || path.endsWith('/'))) ||
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        /[. ]$/.test(part) ||
        /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part),
    )
  )
    unsupportedNpmArchive();
  return { root: parts[0]!, nodes: parts.length };
}
/** Ordinary portable tar only: no links, sparse/GNU/PAX overrides or executable metadata. */
export function npmTarHeader(header: Buffer) {
  if (header.length !== 512) unsupportedNpmArchive();
  if (header.every((value) => value === 0)) return undefined;
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i]!;
  if (checksum !== octal(header.subarray(148, 156))) unsupportedNpmArchive();
  const field = (start: number, length: number) =>
    header
      .subarray(start, start + length)
      .toString('utf8')
      .split('\0')[0]!;
  const prefix = field(345, 155),
    path = `${prefix ? `${prefix}/` : ''}${field(0, 100)}`;
  const type = header[156]!,
    bytes = octal(header.subarray(124, 136));
  const portable = npmArchivePath(path, type);
  if (field(157, 100) || octal(header.subarray(100, 108)) > 0o777 || (type === 53 && bytes !== 0))
    unsupportedNpmArchive();
  return { bytes, path, ...portable, directory: type === 53 };
}
export function npmExpansionFits(
  bytes: number,
  files: number,
  copies: number,
  totalBytes = 0,
  totalFiles = 0,
) {
  if (
    ![bytes, files, copies, totalBytes, totalFiles].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    !copies ||
    !Number.isSafeInteger(bytes * copies + totalBytes) ||
    !Number.isSafeInteger(files * copies + totalFiles) ||
    bytes * copies + totalBytes > NPM_INSTALL_BYTE_LIMIT ||
    files * copies + totalFiles > NPM_INSTALL_FILE_LIMIT
  )
    unsupportedNpmArchive();
  return { expandedBytes: bytes * copies + totalBytes, expandedFiles: files * copies + totalFiles };
}
