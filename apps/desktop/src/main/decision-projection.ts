import { createHash } from 'node:crypto';
import { emptyTimeline, persistsAfterTurn, type TimelineState } from '@skaro/timeline';
import { pendingProposals } from '../shared/feed-actions';
import type { DecisionPayload, DecisionSource, ProjectDecision } from '../shared/project-decisions';

export const decisionHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** A persisted worker name is not evidence that its native permission channel still exists. */
export function integrationDecisionLive(
  state: TimelineState,
  integration: string,
  worker?: string,
) {
  const turn = state.turns.at(-1);
  return (
    !!worker &&
    !!turn &&
    !turn.outcome &&
    turn.id.startsWith(`integration-${integration}:${worker}:`)
  );
}

/** A read projection only; native process permissions never survive a stopped executor. */
export function decisionTimeline(
  state: TimelineState,
  nativeLive: boolean,
  nativePrefix?: string,
): TimelineState {
  return {
    ...emptyTimeline(),
    turns: state.turns.slice(-1),
    interactions: state.interactions.filter(
      (i) =>
        persistsAfterTurn(i) || (nativeLive && (!nativePrefix || i.id.startsWith(nativePrefix))),
    ),
    items: pendingProposals(state.items),
  };
}
/** Match the task view: a completed task cannot offer a second merge from an old log. */
export function taskDecisionTimeline(
  state: TimelineState,
  nativeLive: boolean,
  completed: boolean,
  nativePrefix?: string,
) {
  const snapshot = decisionTimeline(state, nativeLive, nativePrefix);
  if (completed)
    snapshot.interactions = snapshot.interactions.filter(
      (interaction) => interaction.kind !== 'merge',
    );
  return snapshot;
}
export function projectDecisionProjection(sources: DecisionSource[]): ProjectDecision[] {
  const result = new Map<string, ProjectDecision>();
  for (const { timeline, requestEpochs, ...origin } of sources) {
    const payloads: DecisionPayload[] = [
      ...timeline.interactions.map((interaction) => ({
        kind: 'interaction' as const,
        interaction,
      })),
      ...pendingProposals(timeline.items)
        .filter((item) => item.proposal.type !== 'architecture' || item.state === 'pending')
        .map((item) => ({ kind: 'proposal' as const, item })),
    ];
    for (const payload of payloads) {
      const raw = payload.kind === 'interaction' ? payload.interaction.id : payload.item.id;
      const shared = raw.startsWith('coordinator:') || raw.startsWith('skaro-c4-');
      // Adapter request counters may restart within one durable task run.
      const requestEpoch =
        payload.kind === 'interaction' && payload.interaction.kind !== 'merge'
          ? (requestEpochs?.[raw] ?? timeline.turns.at(-1)?.id ?? '')
          : '';
      const id = shared
        ? raw
        : JSON.stringify([origin.kind, origin.id, origin.epoch, requestEpoch, payload.kind, raw]);
      const revision = decisionHash([
        shared
          ? origin.projectId
          : [origin.projectId, origin.kind, origin.id, origin.epoch, requestEpoch],
        payload,
      ]);
      const previous = result.get(id);
      if (previous && previous.revision !== revision)
        throw new Error('decision_projection_conflict');
      result.set(id, previous ?? { ...payload, id, revision, origin });
    }
  }
  return [...result.values()];
}
