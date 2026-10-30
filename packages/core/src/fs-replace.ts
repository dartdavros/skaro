import { rename } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Replaces a file atomically. On Windows another process (an editor, a file watcher, an antivirus
 * scan of the new file) may hold the target for a moment and the replacement fails with EPERM,
 * EACCES or EBUSY. Retrying for a few seconds, as graceful-fs does, keeps one passing lock from
 * failing a whole write; a lock that outlives the retries is reported as it is.
 */
export async function replaceFile(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (attempt >= 40 || !['EPERM', 'EACCES', 'EBUSY'].includes(code)) throw error;
      await delay(Math.min(50 * (attempt + 1), 500));
    }
  }
}
