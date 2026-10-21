/** Admission tickets remain invalid after cancellation, including after an explicit restart. */
export class OperationLifetime {
  private controller = new AbortController();
  private revision = 0;
  private reason: unknown;

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  capture(): number {
    this.signal.throwIfAborted();
    return this.revision;
  }

  assert(ticket: number): void {
    if (ticket !== this.revision) throw this.reason;
    this.signal.throwIfAborted();
  }

  cancel(reason: unknown = new DOMException('Operation cancelled', 'AbortError')): void {
    this.revision++;
    this.reason = reason;
    this.controller.abort(reason);
  }

  renew(): void {
    this.controller = new AbortController();
  }
}
