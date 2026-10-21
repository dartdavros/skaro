import { operationTimeout, type TimelineEvent } from '@skaro/timeline';
import type { Query } from '@anthropic-ai/claude-agent-sdk';

/** Native receipt and terminal event are separate; neither proves queued work was cancelled. */
export class ClaudeInterrupt {
  private active?: string;
  private readonly ending = new Set<() => void>();
  private readonly background = new Set<string>();

  observe(event: TimelineEvent): void {
    if (event.t === 'turn.started') this.active = event.turnId;
    if (event.t === 'turn.completed' && this.active === event.turnId) {
      this.active = undefined;
      for (const resolve of this.ending) resolve();
      this.ending.clear();
    }
    if (event.t === 'item.upsert' && event.item.kind === 'command' && event.item.background) {
      const task = event.item.background;
      if (task.state === 'running') this.background.add(task.taskId);
      else this.background.delete(task.taskId);
    }
  }

  async interrupt(query: Query, close: () => Promise<void>): Promise<void> {
    let resolve!: () => void;
    const ended = this.active
      ? new Promise<void>((done) => {
          resolve = done;
          this.ending.add(done);
        })
      : Promise.resolve();
    try {
      const receipt = await operationTimeout(
        query.interrupt(),
        5000,
        'Claude did not acknowledge interruption',
      );
      // The public SDK API cannot guarantee recall on older CLIs. Retire the transport
      // when delivery remains possible, preserving sessionId for an explicit resume.
      if (!receipt || receipt.still_queued.length) return await close();
      await operationTimeout(
        Promise.all([ended, ...[...this.background].map((id) => query.stopTask(id))]),
        5000,
        'Claude did not confirm turn/task interruption',
      );
    } finally {
      if (resolve) this.ending.delete(resolve);
    }
  }
}
