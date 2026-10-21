import { QuestionAnswers } from './question-answers';
import { hasOwnerCommand } from './owner-command-history';
import { cancelOwnerMessages, CommandCancelled } from './owner-commands';
import { assertQuestionsAnswered, validateQuestionAnswer } from '@skaro/timeline';
// Project chats (architecture.md 9, agent-output.md 5.4): an agent session per chat in the
// project's main working copy, in the "ask" mode (the user confirms edits and commands in cards)
// or with full access, with Skaro's tools for documents, ADRs, milestones and
// tasks. The agent's proposals are items of the chat timeline; the user decides on them in cards,
// and the decisions reach the agent with the user's next message.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { isAsyncQuestion, Timeline, withSkaroNote, type InteractionAnswer } from '@skaro/timeline';
import type { ChatSettings, ChatSummary, MessageInput } from '../shared/ipc';
import { withoutSecrets } from './session-log';
import { PROJECT_CHAT_WORKFLOW } from './chat-workflow';
import { LiveChat } from './chat-model';
import { saved, lastOf, settingsKey, lastKey, currentTurn, titleOf } from './chat-settings-helpers';

import type { ChatEngine } from './chat-engine';
import { stopChat } from './chat-stop';

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
    const commandId = input.commandId ?? randomUUID();
    input = { ...input, commandId };
    const existing = this.ctx.deps.db.commands.get(commandId);
    if (existing) {
      const chat = this.ctx.deps.db.getChat(String(existing.args[1]));
      if (!chat || chat.projectId !== projectId)
        throw new Error('The command belongs to another chat');
      const previous = existing.args[2] as MessageInput;
      if (
        previous.text !== input.text ||
        JSON.stringify(previous.images) !== JSON.stringify(input.images)
      )
        throw new Error('The command identifies a different message');
      return this.ctx.views.summary(chat);
    }
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
    this.ctx.history.skaroEvent(live, {
      t: 'item.upsert',
      item: {
        id: `owner-${input.commandId ?? chat.id}`,
        turnId: '',
        kind: 'message',
        role: 'user',
        text: input.text,
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'owner_command', ref: input.commandId ?? chat.id },
      },
    });
    this.ctx.listChanged(projectId, chat.id);
    this.ctx.deps.db.commands.accept({
      id: commandId,
      method: 'chat.send',
      owner: `${projectId}:${chat.id}`,
      args: [projectId, chat.id, input],
      state: 'accepted',
    });
    this.ctx.deps.db.commands.update(commandId, 'delivering');
    void this.deliver(live, input)
      .then(() => {
        if (this.ctx.deps.db.commands.get(commandId)?.state === 'cancelled') return;
        this.ctx.deps.emit(
          'command.changed',
          this.ctx.deps.db.commands.update(commandId, 'delivered'),
        );
      })
      .catch((error: unknown) => {
        if (
          error instanceof CommandCancelled ||
          this.ctx.deps.db.commands.get(commandId)?.state === 'cancelled'
        )
          return;
        this.ctx.deps.emit(
          'command.changed',
          this.ctx.deps.db.commands.update(commandId, 'failed', String(error)),
        );
        this.ctx.history.failTurn(live, error);
      });
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
    assertQuestionsAnswered(live.timeline.state);
    this.ctx.planningContinuation.userMessage(live);
    return this.queueDelivery(live, input);
  }

  private queueDelivery(live: LiveChat, input: MessageInput, revision?: number): Promise<void> {
    if (live.stopping || live.stopError)
      return Promise.reject(new Error(live.stopError ?? 'Chat is stopping'));
    const deliveryRevision = live.operation.capture();
    const next = live.deliveryQueue
      .catch(() => undefined)
      .then(async () => {
        live.operation.assert(deliveryRevision);
        if (revision !== undefined && revision !== live.planningRevision) return;
        await this.deliverMessage(live, input, revision);
      });
    live.deliveryQueue = next;
    return next;
  }

  async continuePlanning(live: LiveChat, input: MessageInput, revision: number): Promise<void> {
    return this.queueDelivery(live, input, revision);
  }

  private async deliverMessage(
    live: LiveChat,
    input: MessageInput,
    revision?: number,
  ): Promise<void> {
    if (hasOwnerCommand(live.timeline.state, input.commandId)) return;
    input = live.secrets.input(input);
    const deliveryRevision = live.operation.capture();
    const session = await this.ctx.sessions.attach(live);
    live.operation.assert(deliveryRevision);
    assertQuestionsAnswered(live.timeline.state);
    if (input.commandId && this.ctx.deps.db.commands.get(input.commandId)?.state === 'cancelled')
      throw new CommandCancelled();
    if (
      revision !== undefined &&
      (revision !== live.planningRevision || live.timeline.state.status !== 'idle')
    )
      return;
    const notes = this.ctx.proposals.takeNotes(live.chat.id);
    const workflow = this.ctx.importReview.importRecord(live.chat.id) ? '' : PROJECT_CHAT_WORKFLOW;
    const message = {
      ...input,
      text: withSkaroNote(
        [input.commandId ? `command_id: ${input.commandId}` : '', workflow, ...notes]
          .filter(Boolean)
          .join('\n'),
        input.text,
      ),
    };
    try {
      if (revision !== undefined) live.planningSent = true;
      if (live.timeline.state.status === 'idle') await session.send(message);
      else await session.steer(message);
    } catch (error) {
      if (revision !== undefined) live.planningSent = false;
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
    if (live.chat.archived) throw new Error('The chat is archived');
    const interaction = live.timeline.state.interactions.find((i) => i.id === interactionId);
    validateQuestionAnswer(interaction, answer);
    if (interaction?.kind === 'question' && answer.kind === 'question')
      live.secrets.remember(
        interaction.questions.filter((q) => q.secret).flatMap((q) => answer.answers[q.id] ?? []),
      );
    if (
      interaction?.kind === 'question' &&
      (isAsyncQuestion(interaction) ||
        !live.session ||
        !live.timeline.state.turns.some((turn) => !turn.outcome))
    ) {
      const mailbox = new QuestionAnswers(this.ctx.deps.db, `live.${live.chat.id}`);
      mailbox.accept(interaction, answer, (event) => this.ctx.history.skaroEvent(live, event));
      mailbox.queue('chat.send', projectId, chatId, live.timeline.state);
      return;
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
    cancelOwnerMessages(projectId, chatId);
    const live = await this.ctx.history.restore(projectId, chatId);
    return stopChat(this.ctx, live);
  }

  /** An archived chat is read-only: its agent process stops. */
  async archive(projectId: string, chatId: string, archived: boolean): Promise<void> {
    const live = await this.ctx.history.restore(projectId, chatId);
    this.ctx.deps.db.updateChat(chatId, { archived });
    live.chat = this.ctx.deps.db.getChat(chatId)!;
    if (archived) {
      cancelOwnerMessages(projectId, chatId);
      this.ctx.planningContinuation.stop(live, 'Chat archived by the owner.');
      await this.ctx.sessions.detach(live);
    }
    this.ctx.listChanged(projectId, chatId);
  }
}
