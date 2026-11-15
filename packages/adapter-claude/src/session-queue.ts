import { type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

export class InputQueue implements AsyncIterable<SDKUserMessage> {
  private readonly items: { message: SDKUserMessage; current?: () => boolean }[] = [];
  private wake: (() => void) | undefined;
  private ended = false;

  push(message: SDKUserMessage, current?: () => boolean): void {
    this.items.push({ message, current });
    this.wake?.();
  }

  end(): void {
    this.ended = true;
    this.wake?.();
  }
  clear(): void {
    this.items.length = 0;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      const next = this.items.shift();
      if (next) {
        if (next.current && !next.current()) continue;
        yield next.message;
        continue;
      }
      if (this.ended) return;
      await new Promise<void>((resolve) => (this.wake = resolve));
      this.wake = undefined;
    }
  }
}
