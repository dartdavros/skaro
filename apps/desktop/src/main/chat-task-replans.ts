import { projectRecords } from './project-records';
import type { ReplanTasksArgs, SkaroScope, ToolResult } from '@skaro/mcp-server';
import type { ChatEngine } from './chat-engine';
import type { LiveChat, ProposalItem } from './chat-model';
import { prepareTaskReplan } from './task-replan-prepare';
import {
  assertReplanArtifacts,
  assertReplanSnapshot,
  assertTasksUnstarted,
  fingerprint,
  replanContextFingerprint,
} from './task-replan-guard';
import {
  assertTaskGraphAvailable,
  serializeTaskMutation,
  taskReplanLockKey,
} from './project-task-mutations';
import { TaskReplanJournal, type TaskReplanDecision } from './task-replan-journal';
import { settingsKey } from './task-run-helpers';
import { taskFiles } from './task-replan-files';
import { resumeTaskReplan } from './task-replan-execution';
import { beginReplanRevert } from './task-replan-revert';
import { reportReplanFailure, replanNotice } from './task-replan-feedback';

/** Propose, confirm and recover one graph replacement through the existing diff card. */
export class ChatTaskReplans {
  private readonly ctx: ChatEngine;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
  }

  async tool(args: ReplanTasksArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.ctx.context.caller(scope);
    try {
      return await this.propose(live, args);
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error), isError: true };
    }
  }

  async propose(live: LiveChat, args: ReplanTasksArgs): Promise<ToolResult> {
    const context = this.ctx.project(live.projectId);
    return serializeTaskMutation(context, async () => {
      assertTaskGraphAvailable(this.ctx.deps.db, live.projectId);
      const existing = this.ctx.proposals
        .proposals(live)
        .find((item) => item.proposal.type === 'task_replan' && item.proposal.key === args.key);
      if (existing?.proposal.type === 'task_replan') {
        if (existing.proposal.requestFingerprint !== fingerprint(args))
          throw new Error('This key already identifies a different replan. Use a new key.');
        return {
          text: `Replan ${args.key} already exists with state ${existing.state}. Do not duplicate it.`,
        };
      }
      if (this.ctx.planning.store(live).current())
        throw new Error(
          'Finish or explicitly cancel the current planning operation before replanning existing tasks.',
        );
      const artifacts = await context.store.load();
      const proposal = prepareTaskReplan(args, artifacts, this.ctx.deps.locale());
      await assertTasksUnstarted(this.ctx.deps.db, this.ctx.deps.dataDir, context, artifacts, [
        ...proposal.taskIds,
        ...proposal.rewired.map((t) => t.id),
      ]);
      this.ctx.proposals.addProposal(live, proposal, 'pending');
      return {
        text: `The complete replan "${args.title}" is shown as one diff for owner approval. No tasks have changed. Do not create replacement tasks separately.`,
      };
    });
  }

  async accept(live: LiveChat, item: ProposalItem): Promise<void> {
    const context = this.ctx.project(live.projectId);
    await serializeTaskMutation(
      context,
      async () => {
        const journal = new TaskReplanJournal(this.ctx.deps.db, live.projectId);
        const saved = journal.list().find((d) => d.item.id === item.id);
        if (saved) {
          if (saved.phase === 'reverting' || saved.phase === 'reverted')
            throw new Error('This replan is being reverted or has already been reverted.');
          return resumeTaskReplan(this.ctx, live, saved);
        }
        assertTaskGraphAvailable(this.ctx.deps.db, live.projectId);
        if (item.proposal.type !== 'task_replan' || item.state !== 'pending')
          throw new Error('This replan cannot be applied.');
        const artifacts = await context.store.load();
        assertReplanArtifacts(artifacts);
        assertReplanSnapshot(artifacts.tasks, item.proposal.snapshot);
        if (replanContextFingerprint(artifacts) !== item.proposal.contextFingerprint)
          throw new Error(
            'Specifications or milestones changed after this proposal. Prepare a new replan.',
          );
        await assertTasksUnstarted(this.ctx.deps.db, this.ctx.deps.dataDir, context, artifacts, [
          ...item.proposal.taskIds,
          ...item.proposal.rewired.map((t) => t.id),
        ]);
        const decision: TaskReplanDecision = {
          projectId: live.projectId,
          chatId: live.chat.id,
          item,
          phase: 'allocating',
          ids: {},
          before: artifacts.tasks,
          beforeFiles: await taskFiles(
            context.root,
            artifacts.tasks.filter(
              (t) =>
                item.proposal.type === 'task_replan' &&
                (item.proposal.taskIds.includes(t.id) ||
                  item.proposal.rewired.some((r) => r.id === t.id)),
            ),
          ),
          writes: [],
          removes: [],
          preferences: Object.fromEntries(
            item.proposal.taskIds.map((id) => [
              id,
              this.ctx.deps.db.getSetting(settingsKey(live.projectId, id), null),
            ]),
          ),
        };
        // Save the intent first. The in-memory gate holds launches until the durable lock exists.
        journal.save(decision);
        await resumeTaskReplan(this.ctx, live, decision);
      },
      true,
    );
  }

  async revert(live: LiveChat, item: ProposalItem): Promise<void> {
    await serializeTaskMutation(
      this.ctx.project(live.projectId),
      async () => {
        const decision = new TaskReplanJournal(this.ctx.deps.db, live.projectId)
          .list()
          .find((d) => d.item.id === item.id);
        if (!decision) throw new Error('This replan has not been applied.');
        await beginReplanRevert(this.ctx, decision);
        await resumeTaskReplan(this.ctx, live, decision);
      },
      true,
    );
  }

  rejected(live: LiveChat, item: ProposalItem): void {
    replanNotice(
      this.ctx,
      live,
      item,
      'rejected',
      this.ctx.deps.locale() === 'ru'
        ? 'Перепланирование отклонено. Задачи не изменены.'
        : 'Task replan rejected. Tasks were not changed.',
    );
  }

  failed(live: LiveChat, item: ProposalItem, operation: 'apply' | 'revert', error: unknown): void {
    const saved = new TaskReplanJournal(this.ctx.deps.db, live.projectId)
      .list()
      .find((d) => d.item.id === item.id);
    // An executing operation already reported its durable progress and error.
    if (
      saved &&
      saved.phase !== 'applied' &&
      saved.phase !== 'reverted' &&
      saved.item.result?.replan?.operation === operation &&
      saved.item.result.replan.error === (error instanceof Error ? error.message : String(error))
    )
      return;
    reportReplanFailure(this.ctx, live, item, operation, error);
  }

  async recover(live: LiveChat): Promise<void> {
    const journal = new TaskReplanJournal(this.ctx.deps.db, live.projectId);
    if (!journal.list().some((decision) => decision.chatId === live.chat.id)) return;
    await serializeTaskMutation(
      this.ctx.project(live.projectId),
      async () => {
        if (this.ctx.closing || this.ctx.live.get(live.chat.id) !== live) return;
        for (const decision of journal.list()) {
          if (decision.chatId !== live.chat.id) continue;
          const clearedAt = this.ctx.deps.db.getSetting(`chat.${live.chat.id}.clearedAt`, 0);
          if (
            ['applied', 'reverted'].includes(decision.phase) &&
            decision.item.startedAt <= clearedAt
          )
            continue;
          try {
            await resumeTaskReplan(this.ctx, live, decision);
          } catch {
            /* Durable error is shown in the chat. */
          }
        }
      },
      true,
    );
  }

  async recoverAll(): Promise<void> {
    for await (const project of projectRecords(this.ctx.deps.db)) {
      const records = new TaskReplanJournal(this.ctx.deps.db, project.id).list();
      const lock = this.ctx.deps.db.getSetting(taskReplanLockKey(project.id), null);
      for (const chatId of new Set(
        records
          .filter((d) => !['applied', 'reverted'].includes(d.phase) || d.item.id === lock)
          .map((d) => d.chatId),
      )) {
        try {
          const live = await this.ctx.history.restore(project.id, chatId);
          await this.recover(live);
        } catch (error) {
          console.error(`Task replan recovery for ${project.id}/${chatId}:`, error);
        }
      }
    }
  }
}
