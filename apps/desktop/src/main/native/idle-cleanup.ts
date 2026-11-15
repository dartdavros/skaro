/** Idle ownership can appear after asynchronous admission settles, without another native event. */
export class NativeIdleCleanup {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private readonly idle: () => boolean;
  private readonly close: () => Promise<void>;
  constructor(idle: () => boolean, close: () => Promise<void>) {
    this.idle = idle;
    this.close = close;
  }
  observe(): void {
    if (this.stopped || !this.idle()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.stopped && this.idle())
        void this.close().catch((error: unknown) => console.error('Idle native cleanup:', error));
    }, 30000);
    this.timer.unref();
  }
  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }
}
