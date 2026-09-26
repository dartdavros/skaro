// State of the "Чат" section: the chat list, then the open chat — its view from the main process
// and live timeline batches.

import { Timeline, type TimelineState } from '@skaro/timeline';
import type { ChatSummary, ChatView } from '../../../shared/ipc';

export class ChatList {
  readonly projectId: string;
  chats = $state.raw<ChatSummary[]>([]);
  loaded = $state(false);
  private readonly off: () => void;

  constructor(projectId: string) {
    this.projectId = projectId;
    this.off = window.skaro.on('chats.changed', (p) => {
      if (p.projectId === projectId) void this.reload();
    });
  }

  async reload(): Promise<void> {
    try {
      this.chats = await window.skaro.invoke('chats.list', this.projectId);
    } finally {
      this.loaded = true;
    }
  }

  dispose(): void {
    this.off();
  }
}

export class ChatSession {
  readonly projectId: string;
  readonly chatId: string;
  view = $state.raw<ChatView | undefined>();
  timeline = $state.raw<TimelineState | undefined>();
  error = $state<string | undefined>();
  private live: Timeline | undefined;
  private seq = 0;
  private readonly unsubscribe: (() => void)[] = [];
  private reloading: Promise<void> | undefined;
  private reloadAgain = false;

  constructor(projectId: string, chatId: string) {
    this.projectId = projectId;
    this.chatId = chatId;
    this.unsubscribe.push(
      window.skaro.on('chat.events', (batch) => {
        if (batch.projectId !== projectId || batch.chatId !== chatId) return;
        if (!this.live || batch.seq > this.seq) {
          // A gap: the snapshot is the truth.
          void this.reload();
          return;
        }
        const fresh = batch.events.slice(this.seq - batch.seq);
        if (!fresh.length) return;
        for (const event of fresh) this.live.apply(event);
        this.seq += fresh.length;
        this.timeline = { ...this.live.state };
      }),
      window.skaro.on('chats.changed', (p) => {
        if (p.projectId === projectId && p.chatId === chatId) void this.reload();
      }),
    );
  }

  /** Loads (or reloads) the view; overlapping calls collapse into one more round. */
  reload(): Promise<void> {
    if (this.reloading) {
      this.reloadAgain = true;
      return this.reloading;
    }
    this.reloading = (async () => {
      do {
        this.reloadAgain = false;
        try {
          const view = await window.skaro.invoke('chat.open', this.projectId, this.chatId);
          this.view = view;
          this.error = undefined;
          if (view.seq > this.seq || !this.live) {
            this.seq = view.seq;
            this.live = Timeline.restore(structuredClone(view.timeline));
            this.timeline = { ...this.live.state };
          }
        } catch (error) {
          this.error = error instanceof Error ? error.message : String(error);
        }
      } while (this.reloadAgain);
    })().finally(() => (this.reloading = undefined));
    return this.reloading;
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
  }
}
