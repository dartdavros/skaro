import type { AppDb } from '@skaro/core';
import type { EventName, Events } from '../shared/ipc';
import { setBackgroundProjectScope } from './background/client';
import { backgroundWork } from './background-work';
import { attachProjectActivityArchive } from './project-activity';

/** Scope and durable observation precede recovery producers, including during startup. */
export function attachProjectBackground(
  db: AppDb,
  dataDir: string,
  emit: <E extends EventName>(event: E, payload: Events[E]) => void,
) {
  setBackgroundProjectScope(dataDir, db.shell.projectScope);
  attachProjectActivityArchive(db);
  backgroundWork.attach((state) => emit('background.changed', state));
}
