import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** Clearing host history creates a new native journal, rather than reusing the old session file. */
export function builtinSessionDirectory(
  data: string,
  kind: 'tasks' | 'chats',
  ownerId: string,
  sessionId: string,
) {
  const key = createHash('sha256').update(sessionId).digest('hex');
  return join(data, 'builtin', kind, ownerId, key);
}
