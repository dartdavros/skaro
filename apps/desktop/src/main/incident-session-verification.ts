import type { CoordinationBlocker } from '@skaro/core';
import type { TimelineState } from '@skaro/timeline';
import type { TaskRunEngine } from './task-run-engine';

export interface IncidentSessionVerification {
  runId: string;
  failedTurnId: string;
}

/** Only a recorded transport exit can be repaired by observing the agent again. */
export function exitedAgentTurn(state: TimelineState) {
  return state.turns.findLast(
    (turn) =>
      turn.outcome === 'failed' &&
      /^(?:Codex stopped \([^)]*\)|The agent process exited)$/.test(turn.error?.message ?? ''),
  );
}

export async function bindIncidentSession(ctx: TaskRunEngine, row: CoordinationBlocker) {
  const origin = ctx.deps.db.coordination.getEvent(row.projectId, row.eventId)?.source;
  if (
    row.subject.kind !== 'run' ||
    row.protocol?.cause !== 'external' ||
    !/^(?:other|agent_process_exited|executor_[a-f0-9]+)$/.test(row.protocol.code) ||
    origin?.kind !== 'controller' ||
    origin.id !== row.subject.id
  )
    throw new Error('Agent verification only applies to a recorded agent process exit');
  const subscriber = row.protocol.subscriptions.find((s) => s.runId === row.subject.id);
  const active = subscriber && (await ctx.history.restore(row.projectId, subscriber.taskId));
  const failed = active && exitedAgentTurn(active.timeline.state);
  if (!active || active.run.id !== row.subject.id || !failed)
    throw new Error('The incident has no recorded agent process exit');
  return { runId: active.run.id, failedTurnId: failed.id };
}

/** A later native turn is evidence of transport recovery, never of a repaired project service. */
export function sessionRecovered(state: TimelineState, proof: IncidentSessionVerification) {
  const failed = state.turns.findIndex((turn) => turn.id === proof.failedTurnId);
  if (failed < 0 || exitedAgentTurn(state)?.id !== proof.failedTurnId) return false;
  const later = state.turns.slice(failed + 1);
  const latest = later.at(-1);
  return (
    !!latest &&
    later.every((turn) => turn.outcome !== 'failed') &&
    (!latest.outcome || latest.outcome === 'done')
  );
}

export async function checkIncidentSession(
  ctx: TaskRunEngine,
  row: CoordinationBlocker,
  proof: IncidentSessionVerification,
) {
  const bound = await bindIncidentSession(ctx, row);
  if (bound.runId !== proof.runId || bound.failedTurnId !== proof.failedTurnId) return false;
  const active = [...ctx.active.values()].find((a) => a.run.id === proof.runId);
  return (
    !!active?.session &&
    !active.stopping &&
    !active.stopError &&
    !active.switching &&
    sessionRecovered(active.timeline.state, proof)
  );
}
