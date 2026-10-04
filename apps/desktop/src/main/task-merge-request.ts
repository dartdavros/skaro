import { MergeBlockedError } from '@skaro/core';
import type { MergeTaskArgs, ToolResult } from '@skaro/mcp-server';
import { AUTO_MERGE_KEY } from '../shared/ipc';
import type { ProjectContext } from './projects';
import type { ActiveRun, TaskRunDeps } from './tasks';
import type { TaskMergeHooks } from './task-merge-refresh';
import { taskSections } from './task-body';
import { mergeToolReply, type MergeInteraction } from './task-merge-card';
import {
  closeMergeCards,
  completedTaskReply,
  mergedTaskReply,
  unmetReply,
} from './task-merge-result';

/** Called inside the same project queue as automatic and card-confirmed merges. */
export async function requestTaskMerge(
  args: MergeTaskArgs,
  active: ActiveRun,
  context: ProjectContext,
  hooks: TaskMergeHooks & { deps: TaskRunDeps },
  operations: {
    confirm: () => Promise<{ commit: string; base: string }>;
    showCard: () => Promise<MergeInteraction | undefined>;
  },
): Promise<ToolResult> {
  context.invalidate();
  const artifacts = await context.load();
  const task = artifacts.tasks.find((task) => task.id === active.taskId);
  if (!task) return { text: 'The task no longer exists.', isError: true };
  if (task.status === 'done') {
    closeMergeCards(active, hooks);
    return { text: completedTaskReply(active, artifacts.config.baseBranch, hooks.deps.db) };
  }
  if (!active.run.worktree || !active.run.branch)
    return {
      text: 'The task runs in the main working copy: there is no task branch to merge.',
      isError: true,
    };
  const open = taskSections(task.body).criteria.flatMap((criterion, i) =>
    criterion.done ? [] : [i + 1],
  );
  if (open.length) return { text: unmetReply(task, open, 'merge'), isError: true };
  if (args.summary) active.mergeSummary = args.summary;
  if (args.commitMessage) active.commitMessage = args.commitMessage;
  if (hooks.deps.db.getSetting<boolean | null>(AUTO_MERGE_KEY, null) === true) {
    try {
      return { text: mergedTaskReply(await operations.confirm()) };
    } catch (error) {
      // Only real merge blockers fall back to a card; operational failures stay errors.
      if (!(error instanceof MergeBlockedError))
        return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
  const card = await operations.showCard();
  return {
    text: card
      ? mergeToolReply(card)
      : completedTaskReply(active, artifacts.config.baseBranch, hooks.deps.db),
  };
}
