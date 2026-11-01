import { randomUUID } from 'node:crypto';
import type {
  RuntimeAcceptanceState,
  RuntimeVerificationBinding,
  RuntimeVerificationHost,
  VerificationInspectRequest,
  VerificationCancelRequest,
  VerificationInspectReply,
} from '@skaro/timeline';
import { fingerprint } from './inputs.ts';

/** Bounded read-only RPC; cancellation propagates to the existing upstream host. */
export class VerificationClient {
  private readonly binding: RuntimeVerificationBinding;
  private readonly send: (request: VerificationInspectRequest | VerificationCancelRequest) => void;
  private closed = false;
  private readonly pending = new Map<
    string,
    {
      resolve(state: RuntimeAcceptanceState): void;
      reject(error: Error): void;
    }
  >();
  constructor(
    binding: RuntimeVerificationBinding,
    send: (request: VerificationInspectRequest | VerificationCancelRequest) => void,
  ) {
    this.binding = structuredClone(binding);
    this.send = send;
  }
  host(): RuntimeVerificationHost {
    return {
      ...structuredClone(this.binding),
      acceptance: {
        inspect: async (admission, signal) => {
          if (fingerprint(admission) !== fingerprint(this.binding.admission))
            throw new Error('Verification RPC admission differs from its binding');
          return this.inspect(signal);
        },
      },
    };
  }
  private async inspect(signal: AbortSignal): Promise<RuntimeAcceptanceState> {
    signal.throwIfAborted();
    if (this.closed || this.pending.size >= 8) throw new Error('Verification RPC is unavailable');
    const id = randomUUID();
    let reject!: (error: Error) => void;
    const answer = new Promise<RuntimeAcceptanceState>((resolve, failure) => {
      reject = failure;
      this.pending.set(id, { resolve, reject });
    });
    void answer.catch(() => undefined);
    const cancel = () => {
      try {
        this.send({ type: 'verification-cancel', id });
      } catch {
        /* Peer may have exited. */
      }
      reject(new Error('Verification inspection cancelled'));
    };
    const timer = setTimeout(cancel, 20_000);
    signal.addEventListener('abort', cancel, { once: true });
    try {
      this.send({ type: 'verification-inspect', id });
      const state = await answer;
      signal.throwIfAborted();
      if (this.closed) throw new Error('Verification RPC closed');
      return state;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      this.pending.delete(id);
    }
  }
  receive(reply: VerificationInspectReply): void {
    const pending = this.pending.get(reply.id);
    if (!pending) return; // A cancelled/expired request never accepts a late reply.
    try {
      if (reply.error || !reply.state || Buffer.byteLength(JSON.stringify(reply.state)) > 262_144)
        throw new Error('Invalid verification reply');
      pending.resolve(structuredClone(reply.state));
    } catch {
      pending.reject(new Error('Verification host inspection rejected'));
    }
  }
  close(): void {
    this.closed = true;
    for (const [id, pending] of this.pending) {
      try {
        this.send({ type: 'verification-cancel', id });
      } catch {
        /* Peer may have exited. */
      }
      pending.reject(new Error('Verification RPC closed'));
    }
    this.pending.clear();
  }
}
