import { requireAgentId } from '@skaro/agents';
import { type ChatRecord } from '@skaro/core';
import type { ChatSettings, ChatSummary, ChatView } from '../shared/ipc';
import { lastKey } from './chat-settings-helpers';
import { serializeChatMutation } from './chat-mutations';
import { retireChatHistories } from './chat-memory';
import { QuestionAnswers } from './question-answers';
import { presentationState } from './timeline-presentation';
import { historyReads } from './history-read-service';
import { join } from 'node:path';

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
    const { config } = await this.ctx.project(projectId).summary();
    const configured = requireAgentId(config.defaultAgent);
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

  async open(projectId: string, chatId: string, options?: { paged: boolean }): Promise<ChatView> {
    const saved = this.ctx.deps.db.getChat(chatId);
    if (!saved || saved.projectId !== projectId) throw new Error('The chat is not found');
    const owner = `${projectId}:chat:${chatId}`;
    if (options?.paged && !this.ctx.live.has(chatId)) {
      const cached = await historyReads().peek(
        owner,
        join(this.ctx.deps.dataDir, saved.logPath),
        saved.updatedAt,
      );
      if (
        cached &&
        !this.ctx.live.has(chatId) &&
        !this.ctx.deps.db.commands.hasOutstanding(`${projectId}:${chatId}`)
      )
        return {
          projectId,
          chat: this.summary(saved),
          settings: this.ctx.settings.settings(saved),
          timeline: cached.view.timeline,
          history: cached.view.source,
          historyPage: cached.view.page,
          seq: cached.seq,
        };
    }
    const live = await this.ctx.history.restore(projectId, chatId);
    const answers = new QuestionAnswers(this.ctx.deps.db, `live.${chatId}`);
    answers.recover(live.timeline.state, (event) => this.ctx.history.skaroEvent(live, event));
    answers.queue('chat.send', projectId, chatId, live.timeline.state);
    void retireChatHistories(this.ctx, chatId).catch((error: unknown) =>
      console.error('Chat history retirement:', error),
    );
    await serializeChatMutation(live, async () => {
      await this.ctx.replans.recover(live);
      await this.ctx.planReview.consolidate(live);
      await this.ctx.planDecisions.drain(live);
    });
    const read = options?.paged
      ? await historyReads().sync(owner, live.seq, live.timeline.state)
      : undefined;
    if (
      read &&
      !live.session &&
      live.timeline.state.status === 'idle' &&
      !live.timeline.state.interactions.length &&
      !live.timeline.state.items.some(
        (item) => item.kind === 'proposal' && item.proposal.type === 'plan',
      ) &&
      !this.ctx.deps.db.commands.hasOutstanding(`${projectId}:${chatId}`)
    )
      await historyReads().certify(
        read.source,
        join(this.ctx.deps.dataDir, live.chat.logPath),
        live.chat.updatedAt,
      );
    return {
      projectId,
      chat: this.summary(live.chat),
      settings: this.ctx.settings.settings(live.chat),
      timeline: read?.timeline ?? presentationState(live.timeline.state),
      ...(read ? { history: read.source, historyPage: read.page } : {}),
      seq: live.seq,
    };
  }

  summary(chat: ChatRecord): ChatSummary {
    const live = this.ctx.live.get(chat.id);
    return {
      id: chat.id,
      title: chat.title,
      agent: requireAgentId(chat.agent),
      archived: chat.archived,
      ...(this.ctx.importReview.importRecord(chat.id) ? { kind: 'import' as const } : {}),
      live: live !== undefined && live.timeline.state.status !== 'idle',
      updatedAt: chat.updatedAt,
    };
  }
}
