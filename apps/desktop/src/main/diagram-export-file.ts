import { nativeImage } from 'electron';
import { EXPORT_MAX_BYTES, EXPORT_MAX_PIXELS, EXPORT_MAX_SIDE } from '../shared/diagram-export';

export function exportBytes(format: 'png' | 'gexf', value: Uint8Array): Buffer {
  if (
    !['png', 'gexf'].includes(format) ||
    !(value instanceof Uint8Array) ||
    !value.length ||
    value.length > EXPORT_MAX_BYTES
  )
    throw new Error('Invalid diagram export');
  const bytes = Buffer.from(value);
  if (format === 'png') {
    if (
      bytes.length < 24 ||
      bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      bytes.toString('ascii', 12, 16) !== 'IHDR'
    )
      throw new Error('Invalid PNG');
    const width = bytes.readUInt32BE(16),
      height = bytes.readUInt32BE(20);
    if (
      !width ||
      !height ||
      width > EXPORT_MAX_SIDE ||
      height > EXPORT_MAX_SIDE ||
      width * height > EXPORT_MAX_PIXELS
    )
      throw new Error('PNG exceeds export dimensions');
    if (nativeImage.createFromBuffer(bytes).isEmpty()) throw new Error('Invalid PNG');
  } else if (!bytes.subarray(0, 300).toString('utf8').includes('<gexf ')) {
    throw new Error('Invalid GEXF');
  }
  return bytes;
}
export function safeExportName(name: string): string {
  if (
    typeof name !== 'string' ||
    !name ||
    name.length > 200 ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in Windows filenames.
    /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  )
    throw new Error('Invalid export filename');
  return name;
}
