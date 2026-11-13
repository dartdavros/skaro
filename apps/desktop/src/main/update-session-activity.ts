import type { ActiveRun } from './task-run-model';
import type { LiveChat } from './chat-model';

/** Restored history and a durable question are not an executing agent. */
export function updateSessionBusy(live: ActiveRun | LiveChat): boolean {
  return !!(
    live.attaching ||
    live.stopping ||
    ('operations' in live && live.operations.size) ||
    ('planningPending' in live && (live.planningPending || live.planningSending)) ||
    (live.session && live.timeline.state.status === 'working')
  );
}
