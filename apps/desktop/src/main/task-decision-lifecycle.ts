import type { Task } from '@skaro/core';
import type { Item, TimelineState } from '@skaro/timeline';
type Lifecycle = { status: string; archived: boolean };
export function taskRequestsInactive(task: Lifecycle | undefined): boolean {
  return !task || task.archived || ['done', 'cancelled'].includes(task.status);
}
export function stageRequestsArchived(
  id: string,
  tasks: readonly Pick<Task, 'milestone' | 'archived'>[],
): boolean {
  const members = tasks.filter((task) => task.milestone === id);
  return members.length > 0 && members.every((task) => task.archived);
}
export function taskProposalCurrent(
  item: Item,
  tasks: readonly (Lifecycle & Pick<Task, 'id'>)[],
): boolean {
  if (item.kind !== 'proposal' || item.proposal.type !== 'task') return true;
  const id = item.proposal.id;
  return !taskRequestsInactive(tasks.find((task) => task.id === id));
}
/** Read projection only: obsolete actions remain in history in the existing superseded state. */
export function projectTaskProposalLifecycles(
  state: TimelineState,
  tasks: readonly (Lifecycle & Pick<Task, 'id'>)[],
): TimelineState {
  return {
    ...state,
    items: state.items.map((item) =>
      item.kind === 'proposal' && !taskProposalCurrent(item, tasks)
        ? { ...item, state: 'superseded' }
        : item,
    ),
  };
}
