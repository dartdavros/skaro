// Images from agent output and user attachments (architecture.md 4): one file per content,
// <app data>/attachments/<sha256>.<ext>; timelines and logs keep only references.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ImageRef, ProjectionContext } from '@skaro/timeline';

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export class AttachmentStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** Saves image bytes once per content. Synchronous: projections call it inline. */
  save(image: {
    base64: string;
    mime: string;
    width?: number;
    height?: number;
    path?: string;
  }): ImageRef {
    const bytes = Buffer.from(image.base64, 'base64');
    const id = createHash('sha256').update(bytes).digest('hex');
    const file = this.file({ id, mime: image.mime });
    if (!existsSync(file)) {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(file, bytes);
    }
    return {
      id,
      mime: image.mime,
      ...(image.width !== undefined ? { width: image.width } : {}),
      ...(image.height !== undefined ? { height: image.height } : {}),
      ...(image.path !== undefined ? { path: image.path } : {}),
    };
  }

  /** File of a stored image. Project files (with `path`) are not copied and stay where they are. */
  file(ref: Pick<ImageRef, 'id' | 'mime'>): string {
    if (!/^[a-f0-9]{64}$/.test(ref.id)) throw new Error(`not an attachment id: ${ref.id}`);
    return join(this.dir, `${ref.id}.${EXT[ref.mime] ?? 'bin'}`);
  }

  /** Projection context for a live session: Skaro's clock and this store. */
  context(now: () => number = Date.now): ProjectionContext {
    return { now, attachImage: (image) => this.save(image) };
  }
}
