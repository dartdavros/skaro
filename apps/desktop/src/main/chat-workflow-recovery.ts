import type { ChatEngine } from './chat-engine';
import { serializeChatMutation } from './chat-mutations';

/** Recover approved project changes after history has been returned to the renderer. */
export class ChatWorkflowRecovery {
  private readonly pending = new Set<string>();
  private readonly ctx: ChatEngine;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
  }

  schedule(chatId: string, logPath: string | undefined, restoreArchitecture?: () => Promise<void>) {
    if (!logPath || this.ctx.closing || this.pending.has(chatId)) return;
    this.pending.add(chatId);
    setImmediate(() => {
      void this.recover(chatId, logPath, restoreArchitecture)
        .catch((error: unknown) => console.error('Project chat workflow recovery:', error))
        .finally(() => this.pending.delete(chatId));
    });
  }

  private async recover(
    chatId: string,
    logPath: string,
    restoreArchitecture?: () => Promise<void>,
  ) {
    if (this.ctx.closing || this.ctx.deps.db.getChat(chatId)?.logPath !== logPath) return;
    await restoreArchitecture?.().catch((error: unknown) =>
      console.error('Project chat C4 recovery:', error),
    );
    const live = this.ctx.live.get(chatId);
    if (!live || live.chat.logPath !== logPath) return;
    const current = () => !this.ctx.closing && this.ctx.live.get(chatId) === live;
    if (!current()) return;
    await serializeChatMutation(live, async () => {
      if (!current()) return;
      await this.ctx.replans.recover(live);
      if (!current()) return;
      await this.ctx.planReview.consolidate(live);
      if (current()) await this.ctx.planDecisions.drain(live);
    });
    if (current()) this.ctx.planningContinuation.schedule(live);
  }
}
