import type { TimelineEvent } from './model.ts';
import type { TimelineState } from './state.ts';

/** Live indicators shared by agent feeds and task cards. */
export type AgentActivity =
  | Extract<TimelineEvent, { t: 'activity' }>['state']
  | 'starting_environment'
  | 'compacting_context';

export function activityKind(
  activity: TimelineState['activity'],
  environment = false,
): AgentActivity {
  if (activity?.state === 'compacting_context') return 'compacting_context';
  if (environment) return 'starting_environment';
  switch (activity?.state) {
    case 'thinking':
    case 'writing':
    case 'preparing_edit':
      return activity.state;
    default:
      return 'waiting_model';
  }
}

export function startingEnvironment(timeline: TimelineState): boolean {
  const turn = timeline.turns.findLast((t) => !t.outcome)?.id;
  return timeline.items.some(
    (item) =>
      item.kind === 'tool' &&
      !item.parentId &&
      item.turnId === turn &&
      item.server === 'skaro' &&
      item.name === 'start_environment' &&
      item.status === 'running',
  );
}

/** Native compaction and running edits take priority over model deltas until completion. */
export function liveActivity(timeline: TimelineState): TimelineState['activity'] {
  const turn = timeline.turns.findLast((t) => !t.outcome)?.id;
  if (
    turn &&
    timeline.items.some(
      (item) =>
        !item.parentId &&
        item.turnId === turn &&
        item.status === 'running' &&
        item.kind === 'notice' &&
        item.code === 'compaction',
    )
  )
    return { state: 'compacting_context' };
  const edit = timeline.items.findLast(
    (item) =>
      !item.parentId &&
      item.turnId === turn &&
      item.status === 'running' &&
      item.kind === 'file_change',
  );
  if (edit?.kind === 'file_change') return { state: 'preparing_edit', target: edit.files[0]?.path };
  return timeline.activity;
}

/** Completed turns cannot leave a stale animated indicator on the board. */
export function currentActivity(timeline: TimelineState): AgentActivity | undefined {
  if (timeline.status === 'idle') return undefined;
  return activityKind(liveActivity(timeline), startingEnvironment(timeline));
}
