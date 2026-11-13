import type { SkaroScope, ToolResult } from '@skaro/mcp-server';
import { assertQuestionsAnswered } from '@skaro/timeline';
import { LiveChat } from './chat-model';
import { projectContextText } from './chat-context-text';

import type { ChatEngine } from './chat-engine';
import { CompletionStore } from './completion-store';
import type { TrackedCiRun } from './ci-runs';
import { planStatusText } from './chat-planning-status';
import { taskReplanContext } from './task-replan-context';
import { projectMemory } from './project-memory-binding';

export class ChatContext {
  private readonly ctx: ChatEngine;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
  }
  // ── MCP tools of the chat agent ──────────────────────────────────────────

  async context(scope: SkaroScope): Promise<ToolResult> {
    const context = this.ctx.project(scope.projectId);
    const artifacts = await context.load();
    const name = this.ctx.deps.db.getProject(scope.projectId)?.name ?? '';
    const live = scope.chatId ? this.ctx.live.get(scope.chatId) : undefined;
    const plans = live ? this.ctx.planning.store(live).list() : [];
    return {
      text:
        ((await projectMemory(this.ctx.deps.db)?.note(scope.projectId)) ?? '') +
        '\n\n' +
        projectContextText(name, artifacts, this.ctx.deps.db.getTaskRuntime(scope.projectId)) +
        taskReplanContext(this.ctx, scope.projectId, artifacts) +
        (live && plans.length
          ? '\n\n## Saved planning operations\n' +
            plans
              .map((plan) => planStatusText(plan, live.timeline.state.items, artifacts))
              .join('\n')
          : '') +
        (live
          ? '\n\n## Confirmed plans being created or recovering from a write error\n' +
            JSON.stringify(
              this.ctx.proposals
                .proposals(live)
                .filter((p) => p.state === 'accepted')
                .map((p) => ({
                  id: p.id,
                  proposal: p.proposal,
                  result: p.result,
                })),
            )
          : '') +
        '\n\n## Merge blockers\n' +
        JSON.stringify(new CompletionStore(this.ctx.deps.db, scope.projectId).issues()) +
        '\n\n## Merge operations\n' +
        JSON.stringify(
          new CompletionStore(this.ctx.deps.db, scope.projectId)
            .operations()
            .slice(-20)
            .map(({ id, state, base, commit, error, results }) => ({
              id,
              state,
              base,
              commit,
              error,
              tasks: results.map((result) => result.taskId),
            })),
        ) +
        '\n\n## CI and release runs\n' +
        JSON.stringify(
          this.ctx.deps.db
            .getSetting<TrackedCiRun[]>('ci.runs', [])
            .filter((run) => run.projectId === scope.projectId)
            .map(({ repository, runId, kind, remote, error }) => ({
              repository,
              runId,
              kind,
              remote,
              error,
            })),
        ),
    };
  }

  /** The chat whose agent is calling; its grant must be the live one. */
  caller(scope: SkaroScope): LiveChat {
    const live = scope.chatId ? this.ctx.live.get(scope.chatId) : undefined;
    if (!live || live.projectId !== scope.projectId || !live.session) {
      throw new Error('This chat session is no longer active.');
    }
    assertQuestionsAnswered(live.timeline.state);
    return live;
  }
}
