import { MergeBlockedError, newlyUnblocked } from '@skaro/core';
import type { MergeTaskArgs, SubmitResultArgs, SkaroScope, ToolResult } from '@skaro/mcp-server';
import { AUTO_MERGE_KEY } from '../shared/ipc';
import { errorText } from './session-log';
import { setCriteria, taskSections } from './task-body';
import { type MergeInteraction } from './task-merge-card';
import { completedTaskReply, mergedTaskReply, unmetReply } from './task-merge-result';
import { key, findTask } from './task-run-helpers';
import { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { ownsCheckout, stageIdOf } from './task-stage';
import { readSubject, subjectStage, updateSubject } from './task-subject';

/** results: a focused part of the task-run controller. */
export class TaskRunResults {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  async mergeTask(args: MergeTaskArgs, scope: SkaroScope): Promise<ToolResult> {
    if (!scope.taskId) return { text: 'merge_task works only in a task session.', isError: true };
    const active = this.ctx.active.get(key(scope.projectId, scope.taskId));
    if (!active || active.run.id !== scope.runId) {
      return { text: 'This session is no longer the current run of the task.', isError: true };
    }
    const stageId = stageIdOf(active.run);
    if (stageId) {
      return {
        text:
          `This task works in the branch of milestone ${stageId} and is not merged on its own: ` +
          'Skaro merges the whole milestone after its acceptance. Do not call merge_task; ' +
          'tell the user that the task goes into the merge of its milestone.',
      };
    }
    return this.ctx.merges.request(args, active, this.ctx.project(active.projectId));
  }

  closeMergeCard(active: ActiveRun, resolution: 'cancelled' | 'answered' = 'cancelled'): void {
    const open = active.timeline.state.interactions.find((i) => i.kind === 'merge');
    if (open)
      this.ctx.history.skaroEvent(active, { t: 'interaction.closed', id: open.id, resolution });
  }

  async criteriaChanged(
    projectId: string,
    taskId: string,
  ): Promise<'merge' | 'merged' | 'done' | 'stage' | 'open' | 'none'> {
    const context = this.ctx.project(projectId);
    context.invalidate();
    const artifacts = await context.load();
    const task = findTask(artifacts, taskId);
    const criteria = taskSections(task.body).criteria;
    const active =
      this.ctx.active.get(key(projectId, taskId)) ??
      (await this.ctx.history.restore(projectId, taskId));
    // The acceptance of a stage: a milestone without a readiness criterion has nothing to tick.
    const stage = subjectStage(artifacts, taskId);
    if ((!criteria.length && !stage) || !active || task.status === 'done') return 'none';
    const shown = active.timeline.state.interactions.find(
      (i): i is MergeInteraction => i.kind === 'merge',
    );

    if (!criteria.every((c) => c.done)) {
      if (task.status === 'review') await updateSubject(context, taskId, { status: 'in_progress' });
      // The card of a stage stays and says which criterion holds the merge back.
      if (stage && shown) {
        await this.ctx.merges.showCard(active, context, { partial: shown.stage?.partial ?? false });
      } else this.closeMergeCard(active);
      this.ctx.events.settleRuntime(active);
      this.statusChanged(projectId, taskId);
      await this.ctx.stages.sync(projectId, taskId);
      return 'open';
    }
    // Criteria ticked ahead of the tasks: the stage merges when its tasks are done.
    if (stage && task.status !== 'review') return 'none';

    if (!ownsCheckout(active.run)) {
      await this.ctx.stages.complete(active, context, task);
      this.statusChanged(projectId, taskId);
      return 'stage';
    }

    if (!active.run.worktree || !active.run.branch) {
      const before = artifacts.tasks;
      await updateSubject(context, taskId, { status: 'done' });
      context.invalidate();
      const after = (await context.load()).tasks;
      this.statusChanged(projectId, taskId);
      const unblocked = newlyUnblocked(before, after);
      for (const id of unblocked) this.ctx.changed(projectId, id);
      void this.ctx.scheduling.launchUnblocked(projectId, unblocked);
      return 'done';
    }

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
    const stale = stage
      ? card?.stage?.partial || (card?.stage?.unmet.length ?? 0) > 0
      : active.commitMessage && card?.message !== active.commitMessage;
    if (!card || stale) {
      const shown = await this.ctx.merges.showCard(active, context);
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

  async submitResult(args: SubmitResultArgs, scope: SkaroScope): Promise<ToolResult> {
    if (!scope.taskId)
      return { text: 'submit_result works only in a task session.', isError: true };
    const active = this.ctx.active.get(key(scope.projectId, scope.taskId));
    if (!active || active.run.id !== scope.runId) {
      return { text: 'This session is no longer the current run of the task.', isError: true };
    }
    const context = this.ctx.project(active.projectId);
    const task = await readSubject(context, active.taskId);
    if (task.status === 'done') {
      this.closeMergeCard(active, 'answered');
      const artifacts = await context.load();
      return { text: completedTaskReply(active, artifacts.config.baseBranch, this.ctx.deps.db) };
    }
    const criteria = taskSections(task.body).criteria;
    const verdicts = new Map(args.criteria.map((v) => [v.number, v]));
    const wrong = [...verdicts.keys()].filter((n) => n > criteria.length);
    const missing = criteria.map((_, i) => i + 1).filter((n) => !verdicts.has(n));
    if (wrong.length || missing.length) {
      return {
        text:
          `The task has ${criteria.length} acceptance criteria, numbered 1–${criteria.length}. ` +
          (missing.length ? `No verdict for: ${missing.join(', ')}. ` : '') +
          (wrong.length ? `No such criteria: ${wrong.join(', ')}. ` : '') +
          'Give a verdict for every criterion and call submit_result again.',
        isError: true,
      };
    }
    const met = criteria.map((_, i) => verdicts.get(i + 1)!.met);
    await updateSubject(context, task.id, { body: setCriteria(task.body, met) });
    active.mergeSummary = args.summary;
    if (args.commitMessage) active.commitMessage = args.commitMessage;
    const state = await this.criteriaChanged(active.projectId, active.taskId);
    const open = met.flatMap((ok, i) => (ok ? [] : [i + 1]));
    if (open.length) return { text: unmetReply(task, open, 'result') };
    const done = `All ${criteria.length} acceptance criteria are ticked in the task. `;
    if (state === 'merged' && active.merged) {
      return {
        text:
          done +
          'Skaro automatically committed the work and merged the task branch. ' +
          mergedTaskReply(active.merged),
      };
    }
    if (state === 'stage') {
      return {
        text:
          done +
          'Skaro committed the work to the branch of the milestone. The task is merged together ' +
          'with its milestone, after the acceptance of the milestone; do not call merge_task. ' +
          'Tell the user the task is done, with a short summary and how each criterion was checked.',
      };
    }
    return {
      text:
        state === 'merge'
          ? done +
            'Skaro showed the user a card to merge the task branch; the merge happens when the ' +
            'user confirms it. Do not call merge_task. Tell the user the task is done and ready ' +
            'to merge, with a short summary and how each criterion was checked.'
          : done +
            'Tell the user the task is done, with a short summary and how each criterion was checked.',
    };
  }
}
