import { incidentHash } from '@skaro/core';
import type { TaskRunEngine } from './task-run-engine';
import {
  currentTransition,
  linkTransitionIncident,
  type TaskTransition,
} from './task-lifecycle-journal';

/** This incident belongs to an owner control request, even if execution itself is disabled. */
export async function reportLifecycleConflict(
  ctx: TaskRunEngine,
  project: string,
  entry: TaskTransition,
) {
  const current = currentTransition(ctx.deps.db, project, entry.id);
  if (
    !ctx.deps.coordinators ||
    current?.token !== entry.token ||
    current.phase === 'settled' ||
    current.incidentId
  )
    return;
  const row = await ctx.incidents.store.report(
    project,
    { kind: 'task', id: entry.id },
    {
      cause: 'external',
      code: 'task_lifecycle_unconfirmed',
      condition: 'owner-evidence',
      phase: 'waiting',
      resourceVersion: entry.token,
      attempts: 0,
      subscriptions: [],
    },
    {
      taskId: entry.id,
      runId: entry.run ?? `startup:${entry.id}`,
      intent: 0,
      inputs: incidentHash(entry.token),
    },
    `Unconfirmed owner transition to ${entry.target}`,
    'controller',
  );
  linkTransitionIncident(ctx.deps.db, project, entry, row.id);
  ctx.deps.db.addEvent(project, 'task_lifecycle_recovery_required', {
    task: entry.id,
    incident: row.id,
    target: entry.target,
    request: entry.token,
  });
  ctx.changed(project, entry.id);
}
