import type { MergeAction } from '../shared/ipc';
import type { ProjectContext } from './projects';
import { mergeInteraction, type MergeInteraction } from './task-merge-card';
import { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { key } from './task-run-helpers';

/** mergeActions: a focused part of the task-run controller. */
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
    const artifacts = await context.load();
    const base = artifacts.config.baseBranch;
    const branch = active.run.branch!;

    switch (action.action) {
      case 'cancel':
        this.ctx.history.skaroEvent(active, {
          t: 'interaction.closed',
          id: card.id,
          resolution: 'cancelled',
        });
        this.ctx.events.settleRuntime(active);
        return;
      case 'update_branch': {
        const result = await context.git.rebase(active.run.worktree!, base);
        const check = await context.git.checkMerge(base, branch);
        const next = mergeInteraction(card.id, branch, base, check);
        if (card.message) next.message = card.message;
        if (!result.ok) next.conflicts = result.conflicts;
        this.ctx.history.skaroEvent(active, { t: 'interaction.opened', interaction: next });
        return;
      }
      case 'resolve_with_agent': {
        this.ctx.history.skaroEvent(active, {
          t: 'interaction.closed',
          id: card.id,
          resolution: 'cancelled',
        });
        const files = card.conflicts.map((f) => `- ${f}`).join('\n');
        await this.ctx.messages.deliver(active, {
          text:
            `Слияние ветки ${branch} в ${base} даёт конфликты:\n${files}\n\n` +
            `Перенеси ветку на свежую ${base} (git rebase ${base}), разреши конфликты, закоммить ` +
            `результат и снова вызови merge_task.`,
        });
        return;
      }
      case 'confirm':
        await this.confirmMerge(active, context, card, action.message);
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
