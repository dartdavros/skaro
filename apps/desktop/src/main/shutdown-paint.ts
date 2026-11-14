/** A lost renderer must never prevent real shutdown; a stale frame cannot acknowledge it. */
export class ShutdownPaint {
  private pending?: { startedAt: number; finish: () => void };

  wait(startedAt: number, timeoutMs = 1000): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        if (this.pending?.finish === finish) this.pending = undefined;
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      this.pending = { startedAt, finish };
    });
  }

  painted(startedAt: number): void {
    if (this.pending?.startedAt === startedAt) this.pending.finish();
  }
}
