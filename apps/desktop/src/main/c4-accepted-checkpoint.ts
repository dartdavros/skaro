import type { AppDb } from '@skaro/core';

/** A real process crash after the real consent commit, never synthetic records or an alternate API. */
export async function c4AcceptedCheckpoint(db: AppDb, project: string, packageId: string) {
  if (process.env.SKARO_VERIFY_C4_ACCEPTED_CRASH !== packageId) return;
  if (
    db.shell.projectScope !== project ||
    db.getProject(project)?.name.toLowerCase() !== 'cat-pilot'
  )
    throw new Error('C4 crash checkpoint requires the registered scoped Cat-pilot');
  db.addEvent(project, 'c4_accepted_crash_checkpoint', { packageId });
  process.exit(87);
  // Electron's exit request must never let the following writer enter its queue.
  await new Promise<never>(() => {});
}
