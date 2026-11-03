import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { PathScope } from './path-scope.ts';

export const fileHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const MAX_FILE_BYTES = 2_000_000;

export function decodeText(bytes: Buffer): {
  text: string;
  encoding: 'utf8' | 'utf16le';
  bom: boolean;
} {
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe;
  const bom = utf16 || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf);
  const text = new TextDecoder(utf16 ? 'utf-16le' : 'utf-8', { fatal: true }).decode(bytes);
  if (text.includes('\0')) throw new Error('Binary file is not a text file');
  return { text, encoding: utf16 ? 'utf16le' : 'utf8', bom };
}
export function encodeText(text: string, original: ReturnType<typeof decodeText>): Buffer {
  if (new TextDecoder().decode(new TextEncoder().encode(text)) !== text)
    throw new Error('Invalid Unicode text');
  const content = Buffer.from(text, original.encoding);
  return original.bom
    ? Buffer.concat([
        Buffer.from(original.encoding === 'utf16le' ? [0xff, 0xfe] : [0xef, 0xbb, 0xbf]),
        content,
      ])
    : content;
}
export async function readScopedFile(scope: PathScope, path: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const canonical = await scope.path(path);
  const file = await open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
      throw new Error('File is not regular or exceeds the read limit');
    const bytes = await file.readFile({ signal });
    if (bytes.length > MAX_FILE_BYTES) throw new Error('File grew beyond the read limit');
    return { bytes, hash: fileHash(bytes), stat, path: canonical };
  } finally {
    await file.close();
  }
}
