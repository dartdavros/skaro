import { operationTimeout, type RuntimeRpcRequest, type RuntimeRpcReply } from '@skaro/timeline';

/** The bound owner is checked before dispatch and before accepting its result. */
export class RuntimeRpcServer {
  private readonly send: (reply: RuntimeRpcReply) => void;
  private readonly requireOwner: (signal: AbortSignal) => Promise<void>;
  private readonly dispatch: (
    operation: string,
    args: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>;
  private readonly hostSignal?: AbortSignal;
  private readonly lifetime = new AbortController();
  private readonly pending = new Map<string, AbortController>();
  private readonly active = new Set<{ operation: string; work: Promise<void> }>();
  constructor(options: {
    send(reply: RuntimeRpcReply): void;
    requireOwner(signal: AbortSignal): Promise<void>;
    dispatch(operation: string, args: unknown, signal: AbortSignal): Promise<unknown>;
    signal?: AbortSignal;
  }) {
    this.send = options.send;
    this.requireOwner = options.requireOwner;
    this.dispatch = options.dispatch;
    this.hostSignal = options.signal;
  }
  receive(request: RuntimeRpcRequest): void {
    if (request.type === 'runtime-rpc-cancel') {
      this.pending.get(request.id)?.abort();
      return;
    }
    const active = { operation: request.operation, work: this.call(request) };
    this.active.add(active);
    void active.work.finally(() => this.active.delete(active)).catch(() => undefined);
  }
  private async call(request: Extract<RuntimeRpcRequest, { type: 'runtime-rpc-call' }>) {
    let valid = false;
    try {
      valid =
        /^[a-f0-9-]{36}$/.test(request.id) &&
        typeof request.operation === 'string' &&
        request.operation.length <= 200 &&
        Object.keys(request).every((key) => ['type', 'id', 'operation', 'args'].includes(key)) &&
        Buffer.byteLength(JSON.stringify(request)) <= 65_536;
    } catch {
      /* Malformed/cyclic input never reaches the bound handler. */
    }
    if (
      !valid ||
      this.lifetime.signal.aborted ||
      this.pending.size >= 8 ||
      this.pending.has(request.id)
    ) {
      this.send({ type: 'runtime-rpc-result', id: request.id, error: true });
      return;
    }
    const controller = new AbortController();
    this.pending.set(request.id, controller);
    const signal = AbortSignal.any([
      this.lifetime.signal,
      controller.signal,
      ...(this.hostSignal ? [this.hostSignal] : []),
    ]);
    try {
      signal.throwIfAborted();
      await this.requireOwner(signal);
      signal.throwIfAborted();
      const value = await this.dispatch(request.operation, structuredClone(request.args), signal);
      signal.throwIfAborted();
      await this.requireOwner(signal);
      signal.throwIfAborted();
      const reply: RuntimeRpcReply = { type: 'runtime-rpc-result', id: request.id, value };
      if (Buffer.byteLength(JSON.stringify(reply)) > 262_144)
        throw new Error('Scoped RPC reply exceeds the limit');
      this.send(reply);
    } catch {
      if (!this.lifetime.signal.aborted)
        this.send({ type: 'runtime-rpc-result', id: request.id, error: true });
    } finally {
      this.pending.delete(request.id);
    }
  }
  close(): void {
    this.lifetime.abort();
    for (const controller of this.pending.values()) controller.abort();
  }
  async drain(exceptOperation?: string): Promise<void> {
    await operationTimeout(
      Promise.allSettled(
        [...this.active]
          .filter((call) => call.operation !== exceptOperation)
          .map((call) => call.work),
      ),
      30_000,
      'Scoped host calls did not settle',
    );
  }
}
