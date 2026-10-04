import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { ReleasePlatform } from './update-release';

/** Rechecks the cached payload before apply; electron-updater verifies it while downloading. */
export async function verifyPayload(files: string[], platform: ReleasePlatform): Promise<void> {
  if (files.length !== 1) throw new Error('Unexpected Skaro update payload count');
  const file = files[0]!;
  if (!basename(file).endsWith(platform.payload.name.slice(platform.payload.name.lastIndexOf('.'))))
    throw new Error('Unexpected update payload type');
  if ((await stat(file)).size !== platform.payload.size)
    throw new Error('Update payload size changed');
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('base64') !== platform.payload.sha512)
    throw new Error('Update payload integrity check failed');
}
