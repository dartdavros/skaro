import { open, stat } from 'node:fs/promises';

/** Keep UTF-8 code points intact across pages. Raw bytes remain in the private output artifact. */
export async function outputPage(path: string, offset: number, finalized = false) {
  const size = (await stat(path).catch(() => undefined))?.size ?? 0;
  let bytes = Buffer.alloc(Math.min(16_384, Math.max(0, size - offset)));
  if (bytes.length) {
    const file = await open(path, 'r');
    try {
      const { bytesRead } = await file.read(bytes, 0, bytes.length, offset);
      bytes = bytes.subarray(0, bytesRead);
    } finally {
      await file.close();
    }
  }
  let boundary = bytes.length;
  if (boundary) {
    let lead = boundary - 1;
    while (lead > 0 && (bytes[lead]! & 0xc0) === 0x80) lead--;
    const byte = bytes[lead]!;
    const length =
      byte < 0x80
        ? 1
        : (byte & 0xe0) === 0xc0
          ? 2
          : (byte & 0xf0) === 0xe0
            ? 3
            : (byte & 0xf8) === 0xf0
              ? 4
              : 1;
    if (boundary - lead < length && !finalized) boundary = lead;
  }
  bytes = bytes.subarray(0, boundary);
  let decodingWarning: string | null = null;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    decodingWarning = 'Non-UTF-8 output; original bytes are preserved';
  }
  return {
    output: bytes.toString('utf8'),
    offset,
    nextOffset: offset + bytes.length,
    availableBytes: size,
    decodingWarning,
  };
}
