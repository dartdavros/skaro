import type { TaskRunEngine } from './task-run-engine';
import { isReviewQueueKey } from './task-environment-reviews';
import { updateSessionBusy } from './update-session-activity';

export function taskUpdateBusy(ctx: TaskRunEngine): boolean {
  if ([...ctx.active.values()].some(updateSessionBusy)) return true;
  return ctx.queue.state().running.some((key) => {
    if (isReviewQueueKey(key)) {
      const [project, task] = key.split('\n') as [string, string];
      // A ready preview holds a slot until the owner closes it; it is not an agent turn.
      return ctx.reviews.state(project, task.slice('@review:'.length)) !== 'running';
    }
    // Startup, publication and turn finalization may write before/after the session exists.
    // A suspended question owns no executing turn, even if its queue slot is still held.
    return ctx.active.get(key)?.timeline.state.status !== 'waiting';
  });
}
