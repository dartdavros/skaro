/** Unjournalled background failures must reach the process owner, never silently settle a turn. */
export class RuntimeFailures {
  private error?: Error;
  private listener?: (error: Error) => void;
  subscribe(listener: (error: Error) => void) {
    this.listener = listener;
    if (this.error) listener(this.error);
  }
  publish(error: Error) {
    if (this.error) return;
    this.error = new Error(error.message);
    this.listener?.(this.error);
  }
  requireHealthy() {
    if (this.error) throw this.error;
  }
}
