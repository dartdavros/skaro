// Project chats (architecture.md 9, agent-output.md 5.4): an agent session per chat in the
// project's main working copy, in the "ask" mode (the user confirms edits and commands in cards)
// or with full access, with Skaro's tools for documents, ADRs, milestones and
// tasks. The agent's proposals are items of the chat timeline; the user decides on them in cards,
// and the decisions reach the agent with the user's next message.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Timeline } from '@skaro/timeline';
import type { ChatSettings, ChatSummary, ImportSource } from '../shared/ipc';
import { saveState, scanSource, snapshot, type ImportState } from './imports';
import { LiveChat } from './chat-model';
import { importKey, prepFiles } from './chat-import-helpers';
import { saved, settingsKey, currentTurn } from './chat-settings-helpers';

import type { ChatEngine } from './chat-engine';

export class ChatImportStart {
  private readonly ctx: ChatEngine;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
  }
  // ── import of documentation (architecture.md 12) ─────────────────────────

  /** What the import modal says about the picked sources. */
  scanImport(paths: string[]): Promise<ImportSource[]> {
    return Promise.all(paths.map((p) => scanSource(p)));
  }

  /** Creates the import chat at once; copying the sources and the agent go on in the background. */
  async startImport(
    projectId: string,
    paths: string[],
    settings: ChatSettings,
  ): Promise<ChatSummary> {
    this.ctx.project(projectId);
    await this.ctx.settings.ensureAgent(settings.agent);
    const sources = await this.scanImport(paths);
    const missing = sources.find((s) => s.missing);
    if (missing) throw new Error(`${missing.display} is not available`);
    if (!sources.some((s) => s.readable > 0)) throw new Error('Nothing to import');
    const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const dir = join(this.ctx.deps.dataDir, 'imports', projectId, id);
    const chat = this.ctx.deps.db.createChat({
      projectId,
      agent: settings.agent,
      title: this.ctx.importReview.importText().title,
      logPath: join('chats', projectId, `${Date.now()}-${randomUUID().slice(0, 8)}.jsonl`),
    });
    this.ctx.deps.db.setSetting(settingsKey(chat.id), saved(settings));
    this.ctx.deps.db.setSetting(importKey(chat.id), { id, dir });
    const state: ImportState = { id, dir, sources, staged: [] };
    await saveState(state);
    const live = new LiveChat(projectId, chat, new Timeline());
    this.ctx.live.set(chat.id, live);
    this.ctx.listChanged(projectId, chat.id);
    void this.runImport(live, state).catch((error: unknown) =>
      this.ctx.history.failTurn(live, error),
    );
    return this.ctx.views.summary(chat);
  }

  /** The copy of the sources, then the first message with them, then the "prepared" line. */
  async runImport(live: LiveChat, state: ImportState): Promise<void> {
    const manifest = await snapshot(state.sources, state.dir);
    const words = this.ctx.importReview.importText();
    const text = [
      words.title,
      ...state.sources.map((s) => `${s.display} · ${words.files(s.files)}`),
    ].join('\n');
    const before = live.timeline.state.items.length;
    await this.ctx.conversation.deliver(live, { text });
    // The line goes under the user's message: wait for the agent to echo it.
    for (let i = 0; i < 100; i++) {
      if (
        live.timeline.state.items
          .slice(before)
          .some((it) => it.kind === 'message' && it.role === 'user')
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    this.ctx.history.skaroEvent(live, {
      t: 'item.upsert',
      item: {
        id: `skaro-import-prep-${state.id}`,
        turnId: currentTurn(live),
        kind: 'import_prep',
        prepared: manifest.files.filter((f) => f.action !== 'skipped').length,
        skipped: manifest.files.filter((f) => f.action === 'skipped').length,
        files: prepFiles(manifest, words),
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'import_prep', ref: state.id },
      },
    });
  }
}
