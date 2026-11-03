/** Fair reader/writer admission: independent reads overlap, writes never overlap reads/writes. */
export class ToolAccessQueue {
  private readers = 0;
  private writer = false;
  private readonly waiting: { write: boolean; resolve(release: () => void): void }[] = [];
  async run<T>(write: boolean, signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    const release = await new Promise<() => void>((resolve) => {
      this.waiting.push({ write, resolve });
      this.drain();
    });
    try {
      signal.throwIfAborted();
      return await action();
    } finally {
      release();
    }
  }
  private drain(): void {
    if (this.writer) return;
    while (this.waiting.length) {
      const next = this.waiting[0]!;
      if (next.write && this.readers) return;
      this.waiting.shift();
      if (next.write) this.writer = true;
      else this.readers++;
      next.resolve(() => {
        if (next.write) this.writer = false;
        else this.readers--;
        this.drain();
      });
      if (next.write) return;
    }
  }
}
