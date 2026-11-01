import type {
  RuntimeAcceptanceState,
  RuntimeVerificationBinding,
  RuntimeVerificationHost,
  VerificationInspectRequest,
  VerificationCancelRequest,
  VerificationInspectReply,
} from '@skaro/timeline';
import { fingerprint } from './inputs.ts';
import { RuntimeRpcClient } from '../rpc/client.ts';

/** Read-only adapter over the common bounded native RPC. */
export class VerificationClient {
  private readonly binding: RuntimeVerificationBinding;
  private readonly rpc: RuntimeRpcClient;
  constructor(
    binding: RuntimeVerificationBinding,
    send: (request: VerificationInspectRequest | VerificationCancelRequest) => void,
  ) {
    this.binding = structuredClone(binding);
    this.rpc = new RuntimeRpcClient((request) =>
      send({
        type:
          request.type === 'runtime-rpc-cancel' ? 'verification-cancel' : 'verification-inspect',
        id: request.id,
      }),
    );
  }
  host(): RuntimeVerificationHost {
    return {
      ...structuredClone(this.binding),
      acceptance: {
        inspect: async (admission, signal) => {
          if (fingerprint(admission) !== fingerprint(this.binding.admission))
            throw new Error('Verification RPC admission differs from its binding');
          try {
            const state = await this.rpc.call('inspect', null, signal);
            if (!state) throw new Error('Empty verification reply');
            return state as RuntimeAcceptanceState;
          } catch {
            throw new Error('Verification host inspection rejected');
          }
        },
      },
    };
  }
  receive(reply: VerificationInspectReply): void {
    this.rpc.receive({
      type: 'runtime-rpc-result',
      id: reply.id,
      value: reply.state,
      ...(reply.error ? { error: true } : {}),
    });
  }
  close(): void {
    this.rpc.close();
  }
}
