import type { AppDb } from '@skaro/core';
import { requireCoordinationDispatch } from './coordination-dispatch';

/** A persisted queue is data, not renewed authority after off/on or an unknown legacy start. */
export function requireStartupGeneration(db: AppDb, project: string, revision: number | undefined) {
  if (!Number.isSafeInteger(revision) || revision! < 0)
    throw new Error(
      'Saved task startup has no verified dispatch generation; stop it and send a fresh instruction.',
    );
  requireCoordinationDispatch(db, project, revision);
}
