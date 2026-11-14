import type { AppDb } from '@skaro/core';
import type { TimelineState, TimelineEvent } from '@skaro/timeline';
import { taskRequestsInactive } from './task-decision-lifecycle';

/** Task lifecycle wins over old conversation flags and controller request lifetimes. */
export function terminalTaskHistory(
  _db: AppDb,
  status: string,
  _runId?: string,
  archived = false,
): boolean {
  return taskRequestsInactive({ status, archived });
}

export function terminalTaskTimeline(state: TimelineState, terminal: boolean): TimelineState {
  return terminal ? { ...state, interactions: [] } : state;
}

/** Retire obsolete native channels; cancellation is never an invented answer or permission. */
export function retireTerminalTaskRequests(
  state: TimelineState,
  terminal: boolean,
  emit: (event: TimelineEvent) => void,
) {
  if (!terminal) return;
  for (const interaction of [...state.interactions])
    emit({ t: 'interaction.closed', id: interaction.id, resolution: 'cancelled' });
}
