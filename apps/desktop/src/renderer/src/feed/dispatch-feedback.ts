import { emptyTimeline, liveActivity, type TimelineState } from '@skaro/timeline';
import { isBlockingTaskProposal } from '../../../shared/feed-actions';

const waitingModel = { state: 'waiting_model' };

/** An accepted dispatch is visible before the native agent announces a turn or activity. */
export function dispatchFeedback(
  base: TimelineState | undefined,
  pending: boolean,
  answering: readonly string[] = [],
): TimelineState | undefined {
  if (!pending && !answering.length) return base;
  const state = base ?? emptyTimeline();
  if (
    state.status === 'working' ||
    state.interactions.some((item) => item.kind !== 'merge' && !answering.includes(item.id)) ||
    state.items.some((item) => isBlockingTaskProposal(item))
  )
    return base;
  return { ...state, status: 'working', activity: waitingModel };
}

/** Working without a native activity still has the established waiting-model presentation. */
export function feedActivity(state: TimelineState): TimelineState['activity'] {
  return liveActivity(state) ?? (state.status === 'working' ? waitingModel : undefined);
}
