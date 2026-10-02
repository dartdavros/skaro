// Project chats (architecture.md 9, agent-output.md 5.4): an agent session per chat in the
// project's main working copy, in the "ask" mode (the user confirms edits and commands in cards)
// or with full access, with Skaro's tools for documents, ADRs, milestones and
// tasks. The agent's proposals are items of the chat timeline; the user decides on them in cards,
// and the decisions reach the agent with the user's next message.
import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  countSegments,
  persistsAfterTurn,
  replayRunLog,
  Timeline,
  type RawLine,
  type TimelineEvent,
} from '@skaro/timeline';
import { errorText, projectorFor, readRunLog } from './session-log';
import { LiveChat } from './chat-model';
import { currentTurn } from './chat-settings-helpers';

import type { ChatEngine } from './chat-engine';

const FLUSH_MS = 40;
export class ChatHistory {
  private readonly ctx: ChatEngine;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
  }
  onEvent(live: LiveChat, event: TimelineEvent): void {
    live.timeline.apply(event);
    live.seq++;
    live.pending.push(event);
    live.flushTimer ??= setTimeout(() => this.flush(live), FLUSH_MS);
    switch (event.t) {
      case 'session.started':
        if (event.nativeSessionId && event.nativeSessionId !== live.chat.nativeSessionId) {
          this.ctx.deps.db.updateChat(live.chat.id, { nativeSessionId: event.nativeSessionId });
          live.chat = this.ctx.deps.db.getChat(live.chat.id) ?? live.chat;
        }
        return;
      case 'turn.started':
      case 'turn.completed':
        this.ctx.listChanged(live.projectId, live.chat.id);
        return;
    }
  }

  failTurn(live: LiveChat, error: unknown): void {
    const turn = live.timeline.state.turns.at(-1);
    if (turn && !turn.outcome) {
      for (const i of live.timeline.state.interactions) {
        if (persistsAfterTurn(i)) continue;
        this.skaroEvent(live, { t: 'interaction.closed', id: i.id, resolution: 'expired' });
      }
      this.skaroEvent(live, {
        t: 'turn.completed',
        turnId: turn.id,
        outcome: 'failed',
        error: { category: 'other', message: errorText(error) },
      });
    } else {
      this.notice(live, 'other', 'error', errorText(error));
    }
  }

  /** A chat from AppDb, rebuilt from its raw log (principle P2). */
  async restore(projectId: string, chatId: string): Promise<LiveChat> {
    const existing = this.ctx.live.get(chatId);
    if (existing) return existing;
    const chat = this.ctx.deps.db.getChat(chatId);
    if (!chat || chat.projectId !== projectId) throw new Error('The chat is not found');
    const lines = await readRunLog(join(this.ctx.deps.dataDir, chat.logPath));
    const again = this.ctx.live.get(chatId);
    if (again) return again;
    const events = replayRunLog(lines, chat.createdAt, projectorFor(chat.agent), (image) =>
      this.ctx.deps.attachments.save(image),
    );
    const live = new LiveChat(projectId, chat, Timeline.from(events));
    live.seq = events.length;
    live.segments = countSegments(lines);
    this.ctx.live.set(chatId, live);
    // A live turn cannot survive a restart; async questions still wait for a later reply.
    const turn = live.timeline.state.turns.at(-1);
    if (turn && !turn.outcome) {
      for (const i of live.timeline.state.interactions) {
        if (persistsAfterTurn(i)) continue;
        this.skaroEvent(live, { t: 'interaction.closed', id: i.id, resolution: 'expired' });
      }
      this.skaroEvent(live, { t: 'turn.completed', turnId: turn.id, outcome: 'interrupted' });
    }
    return live;
  }

  touch(live: LiveChat): void {
    this.ctx.deps.db.updateChat(live.chat.id, {});
    live.chat = this.ctx.deps.db.getChat(live.chat.id) ?? live.chat;
    this.ctx.listChanged(live.projectId, live.chat.id);
  }

  /** An event Skaro itself adds to the chat; written to the log so replays keep it. */
  skaroEvent(live: LiveChat, event: TimelineEvent): void {
    this.writeLine(live, {
      ts: Date.now() - live.chat.createdAt,
      dir: 'meta',
      line: { skaro: 'event', event },
    });
    this.onEvent(live, event);
  }

  notice(
    live: LiveChat,
    code: 'session_restored' | 'session_lost' | 'other',
    level: 'info' | 'error',
    text: string,
  ): void {
    this.skaroEvent(live, {
      t: 'item.upsert',
      item: {
        id: `skaro-${code}-${randomUUID()}`,
        turnId: currentTurn(live),
        kind: 'notice',
        level,
        code,
        text,
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: code, ref: '' },
      },
    });
  }

  writeLine(live: LiveChat, line: RawLine): void {
    if (!live.log) {
      const path = join(this.ctx.deps.dataDir, live.chat.logPath);
      mkdirSync(dirname(path), { recursive: true });
      const log = createWriteStream(path, { flags: 'a' });
      log.on('error', (error) => console.error(`chat log ${path}: ${error.message}`));
      live.log = log;
    }
    live.log.write(`${JSON.stringify(line)}\n`);
  }

  flush(live: LiveChat): void {
    clearTimeout(live.flushTimer);
    live.flushTimer = undefined;
    if (!live.pending.length) return;
    const events = live.pending;
    live.pending = [];
    this.ctx.deps.emit('chat.events', {
      projectId: live.projectId,
      chatId: live.chat.id,
      seq: live.seq - events.length,
      events,
    });
  }
}
