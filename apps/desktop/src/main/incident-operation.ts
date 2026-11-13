import { incidentHash, type CoordinationBlocker } from '@skaro/core';

/** Renewed task intent is a new dispatch identity; old failed/unknown effects are never replayed. */
export function incidentOperationId(row: CoordinationBlocker): string {
  const subscriptions = [...row.protocol!.subscriptions].sort((a, b) =>
    a.taskId.localeCompare(b.taskId),
  );
  return `remedy:${row.id}:${row.protocol!.attempts}:${incidentHash(subscriptions)}`;
}
