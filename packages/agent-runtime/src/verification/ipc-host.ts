import type {
  RuntimeVerificationHost,
  VerificationInspectRequest,
  VerificationCancelRequest,
  VerificationInspectReply,
} from '@skaro/timeline';

/** No caller-selected task/scope/admission; every inspection uses the bound host lease. */
export class VerificationServer {
  private readonly host: RuntimeVerificationHost;
  private readonly send: (reply: VerificationInspectReply) => void;
  private readonly requireOwner: (signal: AbortSignal) => Promise<void>;
  private readonly lifetime = new AbortController();
  private readonly pending = new Map<string, AbortController>();
  constructor(
    host: RuntimeVerificationHost,
    send: (reply: VerificationInspectReply) => void,
    requireOwner: (signal: AbortSignal) => Promise<void>,
  ) {
    this.send = send;
    this.requireOwner = requireOwner;
    this.host = {
      scope: structuredClone(host.scope),
      admission: structuredClone(host.admission),
      signal: host.signal,
      acceptance: { inspect: host.acceptance.inspect.bind(host.acceptance) },
    };
  }

  receive(request: VerificationInspectRequest | VerificationCancelRequest): void {
    if (request.type === 'verification-cancel') {
      this.pending.get(request.id)?.abort();
      return;
    }
    void this.inspect(request).catch(() => undefined); // An exited peer cannot accept a reply.
  }
  private async inspect(request: VerificationInspectRequest) {
    const valid =
      /^[a-f0-9-]{36}$/.test(request.id) &&
      Object.keys(request).every((key) => key === 'id' || key === 'type');
    if (
      !valid ||
      this.lifetime.signal.aborted ||
      this.pending.size >= 8 ||
      this.pending.has(request.id)
    ) {
      this.send({
        type: 'verification-result',
        id: request.id,
        error: 'Verification host unavailable',
      });
      return;
    }
    const controller = new AbortController();
    this.pending.set(request.id, controller);
    const signal = AbortSignal.any([
      this.lifetime.signal,
      controller.signal,
      ...(this.host.signal ? [this.host.signal] : []),
    ]);
    try {
      signal.throwIfAborted();
      await this.requireOwner(signal);
      const state = await this.host.acceptance.inspect(this.host.admission, signal);
      signal.throwIfAborted();
      await this.requireOwner(signal);
      signal.throwIfAborted();
      if (Buffer.byteLength(JSON.stringify(state)) > 262_144)
        throw new Error('Inspection exceeds the RPC limit');
      this.send({ type: 'verification-result', id: request.id, state });
    } catch {
      if (!this.lifetime.signal.aborted)
        this.send({
          type: 'verification-result',
          id: request.id,
          error: 'Verification host inspection rejected',
        });
    } finally {
      this.pending.delete(request.id);
    }
  }
  close(): void {
    this.lifetime.abort();
    for (const controller of this.pending.values()) controller.abort();
  }
}
