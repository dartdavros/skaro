import { MergeBlockedError, newlyUnblocked } from '@skaro/core';
import type { MergeTaskArgs, SubmitResultArgs, SkaroScope, ToolResult } from '@skaro/mcp-server';
import { AUTO_MERGE_KEY } from '../shared/ipc';
import { errorText } from './session-log';
import { taskSections } from './task-body';
import { type MergeInteraction } from './task-merge-card';
import { mergedTaskReply, unmetReply } from './task-merge-result';
import { key, findTask } from './task-run-helpers';
import { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { lastAgentText } from './task-merges';
import { updateSubject } from './task-subject';
import { IntegrationPending } from './integration-model';
import { completeInPlaceC4 } from './c4-in-place';
import { writeTaskResult } from './task-result-write';
import { serializeTaskMutation } from './project-task-mutations';

/** results: a focused part of the task-run controller. */
export class TaskRunResults {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  async mergeTask(args: MergeTaskArgs, scope: SkaroScope): Promise<ToolResult> {
    if (scope.importId) return { text: 'Import sessions cannot merge tasks.', isError: true };
    if (scope.kind === 'project_chat') {
      if (!!args.taskId === !!args.milestoneId)
        return { text: 'Specify exactly one task_id or milestone_id.', isError: true };
      try {
        const artifacts = await this.ctx.project(scope.projectId).load();
        const task = artifacts.tasks.find((item) => item.id === args.taskId);
        if (task?.status === 'done')
          return { text: `${task.id} is already completed. There is no pending task merge.` };
        const tasks = args.milestoneId
          ? artifacts.tasks.filter(
              (item) => item.milestone === args.milestoneId && item.status !== 'cancelled',
            )
          : [];
        if (tasks.length && tasks.every((item) => item.status === 'done'))
          return {
            text: `Every task of ${args.milestoneId} is already completed. There is no pending milestone merge.`,
          };
        const result = await this.ctx.merges.coordinator.merge(
          scope.projectId,
          args.taskId ?? args.milestoneId!,
          args.partial ?? false,
          args.commitMessage,
        );
        return { text: mergedTaskReply(result) };
      } catch (error) {
        if (error instanceof IntegrationPending) return { text: error.message };
        return { text: errorText(error), isError: true };
      }
    }
    if (!scope.taskId) return { text: 'merge_task works only in a task session.', isError: true };
    const task = await this.ctx.project(scope.projectId).store.readTask(scope.taskId);
    if (
      (args.taskId && args.taskId !== scope.taskId) ||
      (args.milestoneId && args.milestoneId !== task.milestone)
    )
      return { text: 'A task session can only merge its own task or milestone.', isError: true };
    const active = this.ctx.active.get(key(scope.projectId, scope.taskId));
    if (!active || active.run.id !== scope.runId) {
      return { text: 'This session is no longer the current run of the task.', isError: true };
    }
    try {
      return await this.ctx.merges.request(args, active, this.ctx.project(active.projectId));
    } catch (error) {
      if (error instanceof IntegrationPending) return { text: error.message };
      return { text: errorText(error), isError: true };
    }
  }

  closeMergeCard(active: ActiveRun, resolution: 'cancelled' | 'answered' = 'cancelled'): void {
    const open = active.timeline.state.interactions.find((i) => i.kind === 'merge');
    if (open)
      this.ctx.history.skaroEvent(active, { t: 'interaction.closed', id: open.id, resolution });
  }

  async criteriaChanged(
    projectId: string,
    taskId: string,
  ): Promise<'merge' | 'merged' | 'done' | 'conflicts' | 'open' | 'none' | 'integrating'> {
    const context = this.ctx.project(projectId);
    context.invalidate();
    const artifacts = await context.load();
    const task = findTask(artifacts, taskId);
    const criteria = taskSections(task.body).criteria;
    const active =
      this.ctx.active.get(key(projectId, taskId)) ??
      (await this.ctx.history.restore(projectId, taskId));
    if (
      (!criteria.length && !active?.mergeSummary) ||
      !active ||
      active.switching ||
      task.status === 'done'
    )
      return 'none';
    if (!criteria.every((criterion) => criterion.done)) {
      if (task.status === 'review') await updateSubject(context, taskId, { status: 'in_progress' });
      this.closeMergeCard(active);
      this.ctx.events.settleRuntime(active);
      this.statusChanged(projectId, taskId);
      await this.ctx.stages.sync(projectId, taskId);
      return 'open';
    }
    if (!active.run.worktree || !active.run.branch) {
      await completeInPlaceC4(this.ctx.deps.db, context, taskId, active.run.id);
      context.invalidate();
      this.statusChanged(projectId, taskId);
      await this.ctx.stages.sync(projectId, taskId);
      await this.ctx.scheduling.launchUnblocked(
        projectId,
        newlyUnblocked(artifacts.tasks, (await context.load()).tasks),
      );
      return 'done';
    }
    await this.ctx.merges.coordinator.capture(
      projectId,
      taskId,
      active.run.branch,
      active.run.worktree,
      active.commitMessage ?? task.id + ': ' + task.title,
      active.mergeSummary ?? lastAgentText(active),
      active.verification,
    );
    const after = await context.load();
    await this.ctx.stages.sync(projectId, taskId);
    await this.ctx.scheduling.launchUnblocked(
      projectId,
      newlyUnblocked(artifacts.tasks, after.tasks),
    );
    // "Вливать автоматически": commit and merge now; a blocked merge falls back to the card.
    if (this.ctx.deps.db.getSetting<boolean | null>(AUTO_MERGE_KEY, null) === true) {
      const card = active.timeline.state.interactions.find(
        (i): i is MergeInteraction => i.kind === 'merge',
      );
      try {
        active.merged = await this.ctx.mergeActions.confirmMerge(
          active,
          context,
          card,
          active.commitMessage ?? '',
        );
        return 'merged';
      } catch (error) {
        if (error instanceof IntegrationPending) return 'integrating';
        // The agent of the task resolves its conflict in its own checkout and environment.
        if (error instanceof MergeBlockedError && error.check.blockers.includes('conflicts')) {
          await this.ctx.mergeActions.conflicted(active, error.check.conflicts);
          return 'conflicts';
        }
        if (!(error instanceof MergeBlockedError))
          this.ctx.history.notice(active, 'other', 'error', errorText(error));
        context.invalidate();
      }
    }

    // A card is shown once; a new commit message from the agent refreshes it, and so does a
    // stage card that was partial or held back by a criterion.
    const card = active.timeline.state.interactions.find(
      (i): i is MergeInteraction => i.kind === 'merge',
    );
    const stale = active.commitMessage && card?.message !== active.commitMessage;
    if (!card || stale) {
      let shown;
      try {
        shown = await this.ctx.merges.showCard(active, context);
      } catch (error) {
        if (error instanceof IntegrationPending) return 'integrating';
        throw error;
      }
      if (!shown) return active.merged ? 'merged' : 'none';
    }
    this.statusChanged(projectId, taskId);
    return 'merge';
  }

  statusChanged(projectId: string, taskId: string): void {
    this.ctx.project(projectId).invalidate();
    this.ctx.changed(projectId, taskId);
    this.ctx.deps.emit('project.changed', { projectId });
  }

  async submitResult(
    args: SubmitResultArgs,
    scope: SkaroScope,
    beforeWrite?: () => Promise<void>,
  ): Promise<ToolResult> {
    if (!scope.taskId)
      return { text: 'submit_result works only in a task session.', isError: true };
    const active = this.ctx.active.get(key(scope.projectId, scope.taskId));
    if (!active || active.run.id !== scope.runId) {
      return { text: 'This session is no longer the current run of the task.', isError: true };
    }
    const context = this.ctx.project(active.projectId);
    const write = () => writeTaskResult(this.ctx, active, args, beforeWrite);
    const prepared = beforeWrite ? await serializeTaskMutation(context, write) : await write();
    if (prepared.kind === 'reply') return prepared.reply;
    const { task, met } = prepared;
    active.mergeSummary = args.summary;
    active.verification = args.verification;
    if (args.commitMessage) active.commitMessage = args.commitMessage;
    const state = await this.criteriaChanged(active.projectId, active.taskId);
    const open = met.flatMap((ok, i) => (ok ? [] : [i + 1]));
    if (open.length) return { text: unmetReply(task, open, 'result') };
    const done = `All ${met.length} acceptance criteria are ticked in the task. `;
    if (state === 'integrating')
      return {
        text:
          done +
          'Skaro saved the accepted result and is automatically ' +
          'resolving and verifying integration in an isolated candidate. Publication has not happened. ' +
          'End this turn so the integration worker can take its queue slot. Do not change the accepted branch ' +
          'or ask the owner to resolve Git conflicts; Skaro will continue automatically.',
      };
    if (state === 'merged' && active.merged) {
      return {
        text:
          done +
          'Skaro automatically committed the work and merged the task branch. ' +
          mergedTaskReply(active.merged),
      };
    }
    if (state === 'conflicts') return { text: done + (active.conflictOrder ?? '') };
    return {
      text:
        state === 'merge'
          ? done +
            'Skaro showed the user a card to merge the task branch; the merge happens when the ' +
            'user confirms it. Do not call merge_task. Tell the user the accepted result is in review ' +
            'and awaiting merge, with a short summary and how each criterion was checked.'
          : done +
            (state === 'done'
              ? 'The task status is done. Report completion with a short summary and how each criterion was checked.'
              : 'Report the current task status accurately. Acceptance alone does not confirm a merge or completion.'),
    };
  }
}
