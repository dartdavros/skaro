import { incidentHash, type AppDb, type TaskStatus } from '@skaro/core';
import { randomUUID } from 'node:crypto';

/** One owner transition per task. The run binding prevents recovery against a successor. */
export interface TaskTransition {
  id: string;
  token: string;
  revision: number;
  run: string | null;
  from: TaskStatus;
  target: 'paused' | 'stopped' | 'in_progress';
  commandId?: string;
  incidentId?: string;
  phase: 'requested' | 'confirmed' | 'settled';
}
const collection = (project: string) => `task.lifecycle.v1.${project}`;
export function currentTransition(db: AppDb, project: string, task: string) {
  return db.collections.get<TaskTransition>(collection(project), task);
}
export function beginTransition(
  db: AppDb,
  project: string,
  input: Omit<TaskTransition, 'token' | 'phase' | 'revision'>,
) {
  const previous = currentTransition(db, project, input.id);
  const entry: TaskTransition = {
    ...input,
    revision: (previous?.revision ?? 0) + 1,
    token: incidentHash(randomUUID()),
    phase: 'requested',
  };
  db.settings.atomic(() => {
    if (previous?.incidentId) closeIncident(db, project, previous.incidentId, 'cancelled');
    db.collections.put(collection(project), entry);
  });
  return entry;
}
export function transitionPhase(
  db: AppDb,
  project: string,
  entry: TaskTransition,
  phase: TaskTransition['phase'],
) {
  return db.settings.atomic(() => {
    const current = currentTransition(db, project, entry.id);
    if (current?.token !== entry.token || current.phase === 'settled') return false;
    db.collections.put(collection(project), { ...current, phase, revision: current.revision + 1 });
    if (phase === 'settled' && current.incidentId)
      closeIncident(db, project, current.incidentId, 'resolved');
    return true;
  });
}
function closeIncident(db: AppDb, project: string, id: string, state: 'resolved' | 'cancelled') {
  const row = db.coordination.blockers.get(project, id);
  if (row?.state === 'open' && row.protocol?.code === 'task_lifecycle_unconfirmed')
    db.coordination.blockers.transition(project, id, {
      expectedRevision: row.revision,
      state,
      evidence: {
        code: state === 'resolved' ? 'lifecycle_state_verified' : 'owner_transition_superseded',
        refs: [row.subject],
      },
    });
}
export function linkTransitionIncident(
  db: AppDb,
  project: string,
  entry: TaskTransition,
  incidentId: string,
) {
  db.settings.atomic(() => {
    const current = currentTransition(db, project, entry.id);
    if (current?.token !== entry.token) closeIncident(db, project, incidentId, 'cancelled');
    else if (current.phase === 'settled') closeIncident(db, project, incidentId, 'resolved');
    else db.collections.put(collection(project), { ...current, incidentId });
  });
}
export function pendingTransitions(db: AppDb, project: string) {
  return db.collections
    .all<TaskTransition>(collection(project))
    .filter((entry) => entry.phase !== 'settled');
}
export function transitionPending(db: AppDb, project: string, task: string) {
  const entry = currentTransition(db, project, task);
  return !!entry && entry.phase !== 'settled';
}
