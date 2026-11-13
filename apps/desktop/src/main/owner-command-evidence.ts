import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { AppDb, OwnerCommand } from '@skaro/core';
import { isOwnerCommandMessage } from './owner-command-history';
import { replayHistory } from './background/history-replay';

/** Replay saved logs only. Recovery must not attach a session or materialize a checkout. */
export async function savedOwnerCommand(
  db: AppDb,
  dataDir: string,
  command: OwnerCommand,
): Promise<boolean> {
  const [projectId, ownerId] = command.args as [string, string];
  if (db.shell.projectScope && db.shell.projectScope !== projectId)
    throw new Error('Owner command is outside the active project scope');
  if (!db.getProject(projectId)) return false;
  if (command.method === 'chat.send') {
    const chat = db.getChat(ownerId);
    if (!chat || chat.projectId !== projectId) return false;
    return nativeEcho(join(dataDir, chat.logPath), chat.createdAt, chat.agent, command.id);
  }
  if (command.method !== 'task.send') return false;
  // A command may predate a handoff or a retired run. Only this exact task's recorded logs count.
  for (const run of db.listRuns(projectId, ownerId, { includeRetired: true })) {
    if (await nativeEcho(join(dataDir, run.logPath), run.startedAt, run.agent, command.id))
      return true;
  }
  return false;
}

async function nativeEcho(path: string, startedAt: number, agent: string, id: string) {
  let found = false;
  try {
    await replayHistory(
      path,
      startedAt,
      agent,
      {
        // Evidence does not render attachments. Derive their real identity without storing bytes.
        attachImage: ({ base64, ...metadata }) => ({
          ...metadata,
          id: createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex'),
        }),
      },
      (event) => {
        if (event.t === 'item.upsert' && isOwnerCommandMessage(event.item, id)) found = true;
      },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return found;
}
