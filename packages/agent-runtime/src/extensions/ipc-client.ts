import type {
  RuntimeExtensionBinding,
  RuntimeScopedExtensionHost,
  RuntimeRpcRequest,
  RuntimeRpcReply,
} from '@skaro/timeline';
import { RuntimeRpcClient } from '../rpc/client.ts';
import { UnknownToolOutcome } from '../tools/effect-error.ts';

/** Only descriptors cross the boundary; no service handles, grant headers or credentials. */
export class ExtensionClient {
  private readonly binding: RuntimeExtensionBinding;
  private readonly rpc: RuntimeRpcClient;
  constructor(binding: RuntimeExtensionBinding, send: (request: RuntimeRpcRequest) => void) {
    this.binding = structuredClone(binding);
    this.rpc = new RuntimeRpcClient(send, 30 * 60_000);
  }
  host(): RuntimeScopedExtensionHost {
    return {
      scope: structuredClone(this.binding.scope),
      admission: structuredClone(this.binding.admission),
      extensions: {
        interrupt: async () => {
          await this.rpc.call('@interrupt', null, new AbortController().signal, 60_000);
        },
        tools: this.binding.tools.map((tool) => ({
          ...structuredClone(tool),
          invoke: async (callId, args, signal) => {
            try {
              return await this.rpc.call(tool.name, { callId, args }, signal);
            } catch {
              throw new UnknownToolOutcome(
                'Scoped host operation has no confirmed outcome; automatic replay forbidden',
              );
            }
          },
        })),
        close: async () => this.close(),
      },
    };
  }
  receive(reply: RuntimeRpcReply): void {
    this.rpc.receive(reply);
  }
  close(): void {
    this.rpc.close();
  }
}
