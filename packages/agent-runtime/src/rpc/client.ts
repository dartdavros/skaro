import { randomUUID } from 'node:crypto';
import type { RuntimeRpcReply, RuntimeRpcRequest, RuntimeRpcProgress } from '@skaro/timeline';
import { DEFAULT_RPC_LIMITS, type RuntimeRpcLimits } from './limits.ts';

/** Bounded native RPC shared by read-only inspection and privileged extension ports. */
export class RuntimeRpcClient {
  private readonly send: (request: RuntimeRpcRequest) => void;
  private readonly timeoutMs: number;
  private readonly limits: RuntimeRpcLimits;
  private closed = false;
  private readonly pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      cancel(): void;
      onText?: (text: string) => void;
      textBytes: number;
    }
  >();
  constructor(
    send: (request: RuntimeRpcRequest) => void,
    timeoutMs = 20_000,
    limits = DEFAULT_RPC_LIMITS,
  ) {
    this.send = send;
    this.timeoutMs = timeoutMs;
    this.limits = { ...limits };
  }
  async call(
    operation: string,
    args: unknown,
    signal: AbortSignal,
    timeoutMs = this.timeoutMs,
    onText?: (text: string) => void,
  ): Promise<unknown> {
    signal.throwIfAborted();
    if (this.closed || this.pending.size >= 8) throw new Error('Scoped RPC unavailable');
    const id = randomUUID();
    const request: RuntimeRpcRequest = { type: 'runtime-rpc-call', id, operation, args };
    if (Buffer.byteLength(JSON.stringify(request)) > this.limits.requestBytes)
      throw new Error('Scoped RPC request exceeds the limit');
    let reject!: (error: Error) => void;
    let accept!: (value: unknown) => void;
    const answer = new Promise<unknown>((resolve, failure) => {
      reject = failure;
      accept = resolve;
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
    this.pending.set(id, { resolve: accept, reject, cancel, onText, textBytes: 0 });
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
  receive(reply: RuntimeRpcReply | RuntimeRpcProgress): void {
    const pending = this.pending.get(reply.id);
    if (!pending) return;
    try {
      if (reply.type === 'runtime-rpc-progress') {
        if (typeof reply.text !== 'string' || Buffer.byteLength(reply.text) > 16_384)
          throw new Error('Invalid scoped RPC progress');
        pending.textBytes += Buffer.byteLength(reply.text);
        if (pending.textBytes > this.limits.textBytes)
          throw new Error('Scoped RPC text exceeds limit');
        pending.onText?.(reply.text);
        return;
      }
      if (
        reply.error ||
        !Object.hasOwn(reply, 'value') ||
        Buffer.byteLength(JSON.stringify(reply)) > this.limits.replyBytes
      )
        throw new Error('Invalid scoped RPC reply');
      pending.resolve(structuredClone(reply.value));
    } catch {
      pending.cancel();
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
