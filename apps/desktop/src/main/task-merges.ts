import { randomUUID } from 'node:crypto';
import type { MergeTaskArgs } from '@skaro/mcp-server';
import type { ProjectContext } from './projects';
import type { ActiveRun, TaskRunDeps } from './tasks';
import { mergeInteraction, type MergeInteraction } from './task-merge-card';
import type { TaskMergeHooks } from './task-merge-refresh';
import { MergeCardRefresh } from './task-merge-refresh';
import { closeMergeCards, completedTaskReply, mergedTaskReply } from './task-merge-result';
import { undoTaskMerge } from './task-merge-undo';
import { CompletionCoordinator } from './completion-coordinator';
import { CompletionStore } from './completion-store';
import { acceptedResult } from './completion-results';
import { projectCompletion } from './completion-feed';
import { assertPublicationDependencies } from './completion-dependencies';
import { IntegrationPending, currentIntegration } from './integration-model';

/** Chat adapter. All sources of a merge use the same durable coordinator. */
export class TaskMerges {
  readonly coordinator: CompletionCoordinator;
  private readonly refresh: MergeCardRefresh;
  private readonly hooks: TaskMergeHooks & { deps: TaskRunDeps };
  constructor(hooks: TaskMergeHooks & { deps: TaskRunDeps }) {
    this.hooks = hooks;
    this.refresh = new MergeCardRefresh({
      ...hooks,
      refreshCard: async (active) => {
        await this.showCard(active, hooks.project(active.projectId), true);
      },
    });
    this.coordinator = new CompletionCoordinator({
      deps: hooks.deps,
      integrations: hooks.integrations,
      busy: (projectId, taskId) =>
        hooks
          .active()
          .some(
            (run) =>
              run.projectId === projectId &&
              run.taskId === taskId &&
              (!!run.switching || run.timeline.state.status === 'working'),
          ),
      completed: (projectId, operation, unblocked) =>
        projectCompletion(hooks, projectId, operation, unblocked),
      conflicted: async (projectId, taskId, conflicts) => {
        const active =
          hooks.active().find((run) => run.projectId === projectId && run.taskId === taskId) ??
          (await hooks.restore(projectId, taskId));
        if (!active) return false;
        await hooks.conflicted(active, conflicts);
        return true;
      },
      failed: (projectId, taskId, error) => {
        hooks.deps.db.addEvent(projectId, 'completion_failed', { taskId, error });
        hooks.deps.emit('project.changed', { projectId });
        hooks.deps.notify?.('error', error);
        const loaded = hooks
          .active()
          .find((run) => run.projectId === projectId && run.taskId === taskId);
        const run = loaded
          ? Promise.resolve(loaded)
          : taskId
            ? hooks.restore(projectId, taskId).catch(() => undefined)
            : Promise.resolve(undefined);
        void run.then((active) => {
          if (!active) return;
          hooks.skaroEvent(active, {
            t: 'item.upsert',
            item: {
              id: `skaro-completion-error-${projectId}`,
              turnId: active.timeline.state.turns.at(-1)?.id ?? '',
              kind: 'notice',
              level: 'error',
              code: 'other',
              text: error,
              status: 'done',
              startedAt: Date.now(),
              native: { agent: 'skaro', type: 'completion_failed', ref: projectId },
            },
          });
          hooks.changed(projectId, active.taskId);
        });
        console.error(`Completion ${projectId}: ${error}`);
      },
    });
  }

  start(): void {
    this.coordinator.start();
  }
  watch(active: ActiveRun): void {
    if (active.merged) closeMergeCards(active, this.hooks);
    else this.refresh.watch(active);
  }
  close(): Promise<void> {
    this.refresh.close();
    return this.coordinator.close();
  }
  async idle(projectId: string): Promise<void> {
    await this.coordinator.idle(projectId);
  }

  revert(active: ActiveRun, context: ProjectContext, commit: string): Promise<string> {
    return this.coordinator.serialized(active.projectId, () =>
      undoTaskMerge(active, context, commit, this.hooks),
    );
  }

  async request(args: MergeTaskArgs, active: ActiveRun, context: ProjectContext) {
    if (args.summary) active.mergeSummary = args.summary;
    if (args.commitMessage) active.commitMessage = args.commitMessage;
    const task = await context.store.readTask(active.taskId);
    if (task.status === 'done' && !args.milestoneId) {
      closeMergeCards(active, this.hooks);
      return {
        text: completedTaskReply(
          active,
          (await context.load()).config.baseBranch,
          this.hooks.deps.db,
        ),
      };
    }
    if (task.status !== 'done' && task.status !== 'review') {
      if (!active.run.branch || !active.run.worktree)
        throw new Error('The task has no result branch');
      await this.coordinator.capture(
        active.projectId,
        active.taskId,
        active.run.branch,
        active.run.worktree,
        active.commitMessage ?? `${task.id}: ${task.title}`,
        active.mergeSummary,
      );
    }
    const result = await this.coordinator.merge(
      active.projectId,
      active.taskId,
      false,
      args.commitMessage,
    );
    active.merged = result;
    return { text: mergedTaskReply(result) };
  }

  showCard(active: ActiveRun, context: ProjectContext, refresh = false) {
    return this.coordinator.serialized(
      active.projectId,
      async (): Promise<MergeInteraction | undefined> => {
        const previous = active.timeline.state.interactions.find((item) => item.kind === 'merge');
        if (refresh && (!previous || active.switching)) return undefined;
        const integration = currentIntegration(
          this.hooks.integrations.deps.store.all(active.projectId),
          active.taskId,
          ['preparing', 'resolving', 'verifying', 'ready', 'waiting', 'paused', 'failed'],
        );
        if (integration?.localChanges && integration.publish) {
          closeMergeCards(active, this.hooks);
          return undefined;
        }
        context.invalidate();
        const artifacts = await context.load();
        const task = artifacts.tasks.find((item) => item.id === active.taskId);
        if (!task) throw new Error('The task no longer exists');
        if (task.status === 'done') {
          closeMergeCards(active, this.hooks);
          return undefined;
        }
        // A task is merged on its own: its milestone only groups it on the plan.
        const result = await acceptedResult(this.hooks.deps.db, context, task);
        assertPublicationDependencies(
          artifacts,
          [result],
          new CompletionStore(this.hooks.deps.db, active.projectId),
        );
        const base = artifacts.config.baseBranch;
        const check = await context.git.checkMerge(base, result.head);
        check.blockers = check.blockers.filter((blocker) => blocker !== 'no_changes');
        const card = mergeInteraction(previous?.id ?? randomUUID(), result.branch, base, check);
        card.message =
          previous?.kind === 'merge'
            ? (previous.message ?? active.commitMessage ?? result.message)
            : (active.commitMessage ?? result.message);
        if (
          refresh &&
          (active.switching || !active.timeline.state.interactions.includes(previous!))
        )
          return undefined;
        if (JSON.stringify(card) !== JSON.stringify(previous))
          this.hooks.skaroEvent(active, { t: 'interaction.opened', interaction: card });
        if (!refresh) this.hooks.settleRuntime(active);
        this.watch(active);
        return card;
      },
    );
  }

  async confirm(
    active: ActiveRun,
    _context: ProjectContext,
    card: MergeInteraction | undefined,
    message: string,
  ) {
    if (active.switching) throw new Error('The agent is being changed; retry after the handoff');
    const result = await this.coordinator
      .merge(active.projectId, active.taskId, false, message || undefined)
      .catch((error: unknown) => {
        if (error instanceof IntegrationPending) closeMergeCards(active, this.hooks);
        throw error;
      });
    active.merged = result;
    return result;
  }
}

export function lastAgentText(active: ActiveRun): string | undefined {
  for (const item of [...active.timeline.state.items].reverse()) {
    if (item.kind === 'message' && item.role === 'agent' && !item.parentId && item.text.trim())
      return item.text.trim();
  }
  return undefined;
}
