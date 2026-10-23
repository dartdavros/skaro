import { git, MergeBlockedError } from '@skaro/core';
import type { MergeAction } from '../shared/ipc';
import type { ProjectContext } from './projects';
import { type MergeInteraction } from './task-merge-card';
import { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { key } from './task-run-helpers';
import { subjectOf, updateSubject } from './task-subject';
import { CompletionStore } from './completion-store';
import { stageIdOf } from './task-stage';
import { IntegrationPending } from './integration-model';

/** A task is merged on its own by Git; a conflict goes back to its agent, checkout and environment. */
export class TaskRunMergeActions {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }

  async revert(projectId: string, taskId: string, commit: string): Promise<void> {
    const active =
      this.ctx.active.get(key(projectId, taskId)) ??
      (await this.ctx.history.restore(projectId, taskId));
    if (!active) throw new Error('The task has no run');
    await this.ctx.merges.revert(active, this.ctx.project(projectId), commit);
  }

  async merge(
    projectId: string,
    taskId: string,
    interactionId: string,
    action: MergeAction,
  ): Promise<void> {
    const active = this.ctx.requireActive(projectId, taskId);
    const card = active.timeline.state.interactions.find(
      (i): i is MergeInteraction => i.kind === 'merge' && i.id === interactionId,
    );
    if (!card) throw new Error('The merge card is closed');
    const context = this.ctx.project(projectId);
    if (action.action === 'cancel') {
      this.ctx.results.closeMergeCard(active);
      this.ctx.events.settleRuntime(active);
      return;
    }
    if (action.action === 'update_branch') return this.updateBranch(active, context);
    if (action.action === 'resolve_with_agent' && !card.blockers.includes('dirty_base'))
      return this.conflicted(active, card.conflicts);
    try {
      await this.confirmMerge(
        active,
        context,
        card,
        action.action === 'confirm' ? action.message : (card.message ?? ''),
      );
    } catch (error) {
      if (!(await this.handed(active, error))) throw error;
    }
  }

  /** «Обновить ветку»: the accepted branch moves onto the fresh base in its own checkout. */
  private async updateBranch(active: ActiveRun, context: ProjectContext): Promise<void> {
    const { projectId, taskId } = active;
    const { worktree, branch } = active.run;
    if (active.timeline.state.status !== 'idle')
      throw new Error('Wait for the task agent to finish before updating its branch');
    if (!worktree || !branch) throw new Error('The task has no result branch');
    if (stageIdOf(active.run))
      throw new Error(
        'A legacy shared branch must be updated by its task agent and resubmitted; Skaro preserves the other accepted results',
      );
    const base = (await context.load()).config.baseBranch;
    const result = await this.ctx.merges.coordinator.serialized(projectId, async () => {
      if ((await git(worktree, ['status', '--porcelain'])).stdout.trim())
        throw new Error('Preserve uncommitted edits before updating the accepted branch');
      return context.git.rebase(worktree, base);
    });
    if (result.ok) {
      const saved = new CompletionStore(this.ctx.deps.db, projectId).result(taskId);
      const task = await context.store.readTask(taskId);
      await this.ctx.merges.coordinator.capture(
        projectId,
        taskId,
        branch,
        worktree,
        saved?.message ?? `${task.id}: ${task.title}`,
        saved?.summary,
        saved?.verification,
      );
    }
    await this.ctx.merges.showCard(active, context);
  }

  /**
   * The merge of the task met a conflict: its own agent resolves it in the checkout and the
   * environment of the task and submits the result again. No separate candidate is built and
   * nothing is verified a second time.
   */
  async conflicted(active: ActiveRun, conflicts: string[]): Promise<void> {
    const context = this.ctx.project(active.projectId);
    const base = (await context.load()).config.baseBranch;
    const files = conflicts.map((file) => `- ${file}`).join('\n');
    active.conflictOrder =
      `Слияние ветки ${active.run.branch} в ${base} даёт конфликты:\n${files}\n\n` +
      `Влей свежую ${base} в ветку задачи в этой рабочей копии (git merge ${base}), разреши ` +
      'конфликты и закоммить результат. Проверь только то, что затронуло разрешение, и снова ' +
      'вызови submit_result: Skaro вольёт задачу сам, отдельная проверка слияния не запускается.';
    this.ctx.results.closeMergeCard(active);
    new CompletionStore(this.ctx.deps.db, active.projectId).conflict(active.taskId, true);
    await updateSubject(context, active.taskId, { status: 'in_progress' });
    this.ctx.results.statusChanged(active.projectId, active.taskId);
    // Inside its own submit_result the agent reads the order in the reply of the tool.
    if (active.timeline.state.status !== 'idle') return;
    const current = await this.ctx.handoff.recover(active);
    await this.ctx.messages.turn(current, { text: active.conflictOrder });
  }

  /** The base moved under the card: the conflict that appeared goes to the agent of the task. */
  private async handed(active: ActiveRun, error: unknown): Promise<boolean> {
    if (error instanceof IntegrationPending) return true;
    if (!(error instanceof MergeBlockedError) || !error.check.blockers.includes('conflicts'))
      return false;
    await this.conflicted(active, error.check.conflicts);
    return true;
  }

  async mergeFromBoard(projectId: string, taskId: string): Promise<'merged' | 'open'> {
    const active =
      this.ctx.active.get(key(projectId, taskId)) ??
      (await this.ctx.history.restore(projectId, taskId));
    const card = active?.timeline.state.interactions.find(
      (i): i is MergeInteraction => i.kind === 'merge',
    );
    if (!active || !card || card.blockers.length) return 'open';
    const context = this.ctx.project(projectId);
    const task = subjectOf(await context.load(), taskId);
    try {
      await this.confirmMerge(
        active,
        context,
        card,
        card.message ?? `${taskId}: ${task?.title ?? ''}`,
      );
      return 'merged';
    } catch (error) {
      if (await this.handed(active, error)) return 'open';
      throw error;
    }
  }

  confirmMerge(
    active: ActiveRun,
    context: ProjectContext,
    card: MergeInteraction | undefined,
    message: string,
  ) {
    return this.ctx.merges.confirm(active, context, card, message);
  }
}
