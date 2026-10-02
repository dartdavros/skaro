import { type ChatRecord } from '@skaro/core';
import type { ChatSettings, ChatSummary, ChatView } from '../shared/ipc';
import { lastKey } from './chat-settings-helpers';

import type { ChatEngine } from './chat-engine';

export class ChatViews {
  private readonly ctx: ChatEngine;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
  }
  // ── list and views ───────────────────────────────────────────────────────

  list(projectId: string): ChatSummary[] {
    const { db } = this.ctx.deps;
    return [...db.listChats(projectId), ...db.listChats(projectId, { archived: true })]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((chat) => this.summary(chat));
  }

  /** A new chat starts with the agent of the last chat, else the project's default agent. */
  async defaults(projectId: string): Promise<ChatSettings> {
    const { agents } = this.ctx.deps;
    const last = this.ctx.deps.db.getSetting<ChatSettings | null>(lastKey(projectId), null);
    if (last && agents.readyAgent(last.agent) === last.agent) return last;
    const { config } = await this.ctx.project(projectId).load();
    const configured = config.defaultAgent === 'codex' ? 'codex' : 'claude-code';
    // An absent agent is inactive: a new chat starts with a ready one.
    const agent = agents.readyAgent(configured);
    return {
      agent,
      ...(agent === configured && config.defaultModel ? { model: config.defaultModel } : {}),
      ...(agent === configured && config.defaultModel && config.defaultEffort
        ? { effort: config.defaultEffort }
        : {}),
    };
  }

  async open(projectId: string, chatId: string): Promise<ChatView> {
    const live = await this.ctx.history.restore(projectId, chatId);
    return {
      projectId,
      chat: this.summary(live.chat),
      settings: this.ctx.settings.settings(live.chat),
      timeline: live.timeline.state,
      seq: live.seq,
    };
  }

  summary(chat: ChatRecord): ChatSummary {
    const live = this.ctx.live.get(chat.id);
    return {
      id: chat.id,
      title: chat.title,
      agent: chat.agent === 'codex' ? 'codex' : 'claude-code',
      archived: chat.archived,
      ...(this.ctx.importReview.importRecord(chat.id) ? { kind: 'import' as const } : {}),
      live: live !== undefined && live.timeline.state.status !== 'idle',
      updatedAt: chat.updatedAt,
    };
  }
}
