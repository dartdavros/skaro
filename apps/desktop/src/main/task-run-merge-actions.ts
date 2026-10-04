import type { MergeAction } from '../shared/ipc';
import type { ProjectContext } from './projects';
import { mergeInteraction, withStage, type MergeInteraction } from './task-merge-card';
import { ActiveRun } from './task-run-model';
import type { TaskRunEngine } from './task-run-engine';
import { key } from './task-run-helpers';
import { subjectOf } from './task-subject';

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
        withStage(next, card.stage);
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
        await this.ctx.messages.turn(active, {
          text:
            `Слияние ветки ${branch} в ${base} даёт конфликты:\n${files}\n\n` +
            `Перенеси ветку на свежую ${base} (git rebase ${base}), разреши конфликты, закоммить ` +
            `результат и снова вызови ${card.stage ? 'submit_result' : 'merge_task'}.`,
        });
        return;
      }
      case 'confirm': {
        // The messages of the card as the user left them go to the commits of the tasks.
        const messages = action.messages;
        if (card.stage && messages)
          card.stage = {
            ...card.stage,
            tasks: card.stage.tasks.map((t) => ({ ...t, message: messages[t.id] ?? t.message })),
          };
        await this.confirmMerge(active, context, card, action.message);
      }
    }
  }

  /**
   * "На ревью" → "Готово" on the board: merges with the task's open merge card and its message.
   * Without a card, or with a blocked one, the user decides in the task's feed.
   */
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
    await this.confirmMerge(
      active,
      context,
      card,
      card.message ?? `${taskId}: ${task?.title ?? ''}`,
    );
    return 'merged';
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
