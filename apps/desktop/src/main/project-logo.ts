// The project's logo ("Параметры проекта"): a picked SVG, PNG or JPG kept in AppDb as a data: URL.

import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { LOGO_MAX_BYTES } from '../shared/ipc';

const TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/** Extensions for the file picker. */
export const LOGO_EXTENSIONS = Object.keys(TYPES).map((e) => e.slice(1));

export async function readLogo(path: string): Promise<string> {
  const type = TYPES[extname(path).toLowerCase()];
  if (!type) throw new Error('unsupported');
  if ((await stat(path)).size > LOGO_MAX_BYTES) throw new Error('too large');
  const data = await readFile(path);
  return `data:${type};base64,${data.toString('base64')}`;
}
