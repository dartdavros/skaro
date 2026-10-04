import type { SkaroScope, ToolResult } from '@skaro/mcp-server';
import { LiveChat } from './chat-model';
import { projectContextText } from './chat-context-text';

import type { ChatEngine } from './chat-engine';

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
    return {
      text: projectContextText(name, artifacts, this.ctx.deps.db.getTaskRuntime(scope.projectId)),
    };
  }

  /** The chat whose agent is calling; its grant must be the live one. */
  caller(scope: SkaroScope): LiveChat {
    const live = scope.chatId ? this.ctx.live.get(scope.chatId) : undefined;
    if (!live || live.projectId !== scope.projectId || !live.session) {
      throw new Error('This chat session is no longer active.');
    }
    return live;
  }
}
