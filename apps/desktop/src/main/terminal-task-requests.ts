import type { AppDb } from '@skaro/core';
import type { TimelineState, TimelineEvent } from '@skaro/timeline';
import { TaskExecution } from './task-execution';

/** A renewed conversation is durable too: its real unanswered questions survive restart. */
export function terminalTaskHistory(db: AppDb, status: string, runId?: string): boolean {
  return (
    ['done', 'cancelled'].includes(status) &&
    !(runId && new TaskExecution(db, runId).read().followUp)
  );
}

export function terminalTaskTimeline(state: TimelineState, terminal: boolean): TimelineState {
  return terminal
    ? { ...state, interactions: state.interactions.filter((i) => i.id.startsWith('coordinator:')) }
    : state;
}

/** Retire obsolete native channels; cancellation is never an invented answer or permission. */
export function retireTerminalTaskRequests(
  state: TimelineState,
  terminal: boolean,
  emit: (event: TimelineEvent) => void,
) {
  if (!terminal) return;
  for (const interaction of [...state.interactions])
    if (!interaction.id.startsWith('coordinator:'))
      emit({ t: 'interaction.closed', id: interaction.id, resolution: 'cancelled' });
}
