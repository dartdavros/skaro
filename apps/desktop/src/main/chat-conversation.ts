// Project chats (architecture.md 9, agent-output.md 5.4): an agent session per chat in the
// project's main working copy, in the "ask" mode (the user confirms edits and commands in cards)
// or with full access, with Skaro's tools for documents, ADRs, milestones and
// tasks. The agent's proposals are items of the chat timeline; the user decides on them in cards,
// and the decisions reach the agent with the user's next message.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  isAsyncQuestion,
  asyncQuestionInput,
  Timeline,
  withSkaroNote,
  type InteractionAnswer,
} from '@skaro/timeline';
import type { ChatSettings, ChatSummary, MessageInput } from '../shared/ipc';
import { withoutSecrets } from './session-log';
import { LiveChat } from './chat-model';
import { saved, lastOf, settingsKey, lastKey, currentTurn, titleOf } from './chat-settings-helpers';

import type { ChatEngine } from './chat-engine';

export class ChatConversation {
  private readonly ctx: ChatEngine;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
  }
  // ── conversation ─────────────────────────────────────────────────────────

  /** A chat starts with its first message; the agent is fixed from then on (D-24). */
  async create(
    projectId: string,
    settings: ChatSettings,
    input: MessageInput,
  ): Promise<ChatSummary> {
    this.ctx.project(projectId);
    await this.ctx.settings.ensureAgent(settings.agent);
    const chat = this.ctx.deps.db.createChat({
      projectId,
      agent: settings.agent,
      title: titleOf(input.text),
      logPath: join('chats', projectId, `${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`),
    });
    this.ctx.deps.db.setSetting(settingsKey(chat.id), saved(settings));
    this.ctx.deps.db.setSetting(lastKey(projectId), lastOf(settings));
    const live = new LiveChat(projectId, chat, new Timeline());
    this.ctx.live.set(chat.id, live);
    this.ctx.listChanged(projectId, chat.id);
    // Starting the agent takes a while; failures show in the chat itself.
    void this.deliver(live, input).catch((error: unknown) =>
      this.ctx.history.failTurn(live, error),
    );
    return this.ctx.views.summary(chat);
  }

  async send(projectId: string, chatId: string, input: MessageInput): Promise<void> {
    const live = await this.ctx.history.restore(projectId, chatId);
    if (live.chat.archived) throw new Error('The chat is archived');
    this.ctx.history.touch(live);
    await this.deliver(live, input);
  }

  /** Sends a message; decisions on proposals since the last message go in front of it. */
  async deliver(live: LiveChat, input: MessageInput): Promise<void> {
    const session = await this.ctx.sessions.attach(live);
    const notes = this.ctx.proposals.takeNotes(live.chat.id);
    const message = { ...input, text: withSkaroNote(notes.join('\n'), input.text) };
    try {
      if (live.timeline.state.status === 'idle') await session.send(message);
      else await session.steer(message);
    } catch (error) {
      this.ctx.proposals.addNotes(live.chat.id, notes);
      throw error;
    }
  }

  async respond(
    projectId: string,
    chatId: string,
    interactionId: string,
    answer: InteractionAnswer,
  ): Promise<void> {
    const live = await this.ctx.history.restore(projectId, chatId);
    const interaction = live.timeline.state.interactions.find((i) => i.id === interactionId);
    if (isAsyncQuestion(interaction)) {
      await this.send(projectId, chatId, asyncQuestionInput(interaction, answer));
      this.ctx.history.skaroEvent(live, {
        t: 'interaction.closed',
        id: interactionId,
        resolution: 'answered',
      });
    } else {
      if (!live.session) throw new Error('The agent session has ended');
      await live.session.respond(interactionId, answer);
    }
    if (!interaction) return;
    this.ctx.history.skaroEvent(live, {
      t: 'item.upsert',
      item: {
        id: `skaro-decision-${interactionId}`,
        turnId: isAsyncQuestion(interaction) ? '' : currentTurn(live),
        kind: 'decision',
        interaction,
        answer: withoutSecrets(interaction, answer),
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'decision', ref: interactionId },
      },
    });
  }

  async interrupt(projectId: string, chatId: string): Promise<void> {
    await (await this.ctx.history.restore(projectId, chatId)).session?.interrupt();
  }

  /** An archived chat is read-only: its agent process stops. */
  async archive(projectId: string, chatId: string, archived: boolean): Promise<void> {
    const live = await this.ctx.history.restore(projectId, chatId);
    this.ctx.deps.db.updateChat(chatId, { archived });
    live.chat = this.ctx.deps.db.getChat(chatId)!;
    if (archived) await this.ctx.sessions.detach(live);
    this.ctx.listChanged(projectId, chatId);
  }
}
