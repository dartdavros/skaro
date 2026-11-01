import { randomUUID } from 'node:crypto';
import type { RuntimeRpcReply, RuntimeRpcRequest } from '@skaro/timeline';

/** Bounded native RPC shared by read-only inspection and privileged extension ports. */
export class RuntimeRpcClient {
  private readonly send: (request: RuntimeRpcRequest) => void;
  private readonly timeoutMs: number;
  private closed = false;
  private readonly pending = new Map<
    string,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  constructor(send: (request: RuntimeRpcRequest) => void, timeoutMs = 20_000) {
    this.send = send;
    this.timeoutMs = timeoutMs;
  }
  async call(
    operation: string,
    args: unknown,
    signal: AbortSignal,
    timeoutMs = this.timeoutMs,
  ): Promise<unknown> {
    signal.throwIfAborted();
    if (this.closed || this.pending.size >= 8) throw new Error('Scoped RPC unavailable');
    const id = randomUUID();
    const request: RuntimeRpcRequest = { type: 'runtime-rpc-call', id, operation, args };
    if (Buffer.byteLength(JSON.stringify(request)) > 65_536)
      throw new Error('Scoped RPC request exceeds the limit');
    let reject!: (error: Error) => void;
    const answer = new Promise<unknown>((resolve, failure) => {
      reject = failure;
      this.pending.set(id, { resolve, reject });
    });
    void answer.catch(() => undefined);
    const cancel = () => {
      try {
        this.send({ type: 'runtime-rpc-cancel', id });
      } catch {
        /* The peer may have exited. */
      }
      reject(new Error('Scoped RPC cancelled'));
    };
    const timer = setTimeout(cancel, timeoutMs);
    signal.addEventListener('abort', cancel, { once: true });
    try {
      this.send(structuredClone(request));
      const value = await answer;
      signal.throwIfAborted();
      if (this.closed) throw new Error('Scoped RPC closed');
      return value;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      this.pending.delete(id);
    }
  }
  receive(reply: RuntimeRpcReply): void {
    const pending = this.pending.get(reply.id);
    if (!pending) return;
    try {
      if (
        reply.error ||
        !Object.hasOwn(reply, 'value') ||
        Buffer.byteLength(JSON.stringify(reply)) > 262_144
      )
        throw new Error('Invalid scoped RPC reply');
      pending.resolve(structuredClone(reply.value));
    } catch {
      pending.reject(new Error('Scoped host request rejected'));
    }
  }
  close(): void {
    this.closed = true;
    for (const [id, pending] of this.pending) {
      try {
        this.send({ type: 'runtime-rpc-cancel', id });
      } catch {
        /* The peer may have exited. */
      }
      pending.reject(new Error('Scoped RPC closed'));
    }
    this.pending.clear();
  }
}
