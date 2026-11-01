import type {
  RuntimeAcceptanceState,
  RuntimeVerificationHost,
  VerificationInspectRequest,
  VerificationCancelRequest,
  VerificationInspectReply,
} from '@skaro/timeline';
import { RuntimeRpcServer } from '../rpc/server.ts';

/** No caller-selected task/scope/admission; inspections use the immutable host binding. */
export class VerificationServer {
  private readonly rpc: RuntimeRpcServer;
  private readonly send: (reply: VerificationInspectReply) => void;
  constructor(
    host: RuntimeVerificationHost,
    send: (reply: VerificationInspectReply) => void,
    requireOwner: (signal: AbortSignal) => Promise<void>,
  ) {
    this.send = send;
    const admission = structuredClone(host.admission);
    const inspect = host.acceptance.inspect.bind(host.acceptance);
    this.rpc = new RuntimeRpcServer({
      requireOwner,
      signal: host.signal,
      dispatch: async (_operation, _args, signal) => inspect(admission, signal),
      send: (reply) =>
        send({
          type: 'verification-result',
          id: reply.id,
          ...(reply.error
            ? { error: 'Verification host inspection rejected' }
            : { state: reply.value as RuntimeAcceptanceState }),
        }),
    });
  }
  receive(request: VerificationInspectRequest | VerificationCancelRequest): void {
    const valid = Object.keys(request).every((key) => key === 'type' || key === 'id');
    if (!valid) {
      this.send({
        type: 'verification-result',
        id: request.id,
        error: 'Verification host inspection rejected',
      });
      return;
    }
    this.rpc.receive(
      request.type === 'verification-cancel'
        ? { type: 'runtime-rpc-cancel', id: request.id }
        : { type: 'runtime-rpc-call', id: request.id, operation: 'inspect', args: null },
    );
  }
  close(): void {
    this.rpc.close();
  }
}
