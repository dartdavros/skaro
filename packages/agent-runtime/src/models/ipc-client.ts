import type {
  RuntimeModelBinding,
  RuntimeModelHost,
  RuntimeModelRpcRequest,
  RuntimeModelRpcReply,
} from '@skaro/timeline';
import { RuntimeRpcClient } from '../rpc/client.ts';
import { MODEL_RPC_LIMITS } from '../rpc/limits.ts';
import { fingerprint } from '../verification/inputs.ts';
import { ModelHttpError } from './model-error.ts';

/** Real connector proxy; streaming text and native response data retain their order. */
export class ModelClient {
  private readonly binding: RuntimeModelBinding;
  private readonly rpc: RuntimeRpcClient;
  private readonly lifetime = new AbortController();
  constructor(binding: RuntimeModelBinding, send: (request: RuntimeModelRpcRequest) => void) {
    this.binding = structuredClone(binding);
    this.rpc = new RuntimeRpcClient(
      (request) =>
        send(
          request.type === 'runtime-rpc-cancel'
            ? { type: 'model-rpc-cancel', id: request.id }
            : { ...request, type: 'model-rpc-call' },
        ),
      120_000,
      MODEL_RPC_LIMITS,
    );
  }
  host(): RuntimeModelHost {
    const tools = this.binding.policy.tools;
    return {
      ...structuredClone(this.binding),
      signal: this.lifetime.signal,
      input: this.binding.policy.input && {
        revision: this.binding.policy.input.revision,
        prepare: async (input, signal) =>
          this.rpc.call('prepare-input', input.commandId, signal) as Promise<
            import('@skaro/timeline').RuntimePreparedModelTurn
          >,
      },
      toolAdmission: tools && {
        ...tools,
        ...(tools.selectChatTools
          ? {
              selectChatTools: async (catalogue, signal) =>
                this.rpc.call('select-tools', catalogue, signal ?? this.lifetime.signal) as Promise<
                  typeof catalogue
                >,
            }
          : { selectChatTools: undefined }),
        requireAllowed: async (name, args, signal) => {
          await this.rpc.call('allow-tool', { name, args }, signal ?? this.lifetime.signal);
        },
        projectResult: async (result, signal) =>
          this.rpc.call('project-tool', result, signal ?? this.lifetime.signal),
      },
      reserve: async (id, request, signal) =>
        this.rpc.call('reserve', { id, request }, signal) as Promise<Record<string, unknown>>,
      complete: async (id, request, signal, onText) => {
        const result = (await this.rpc.call(
          'complete',
          { id, request },
          signal,
          120_000,
          onText,
        )) as {
          outcome: string;
          status?: number;
          response?: Awaited<ReturnType<RuntimeModelHost['complete']>>;
        };
        if (result.outcome === 'http-error' && Number.isInteger(result.status))
          throw new ModelHttpError(result.status!);
        if (
          result.outcome !== 'completed' ||
          !result.response ||
          result.response.kind !== request.kind ||
          fingerprint(result.response.value.provenance.route) !== fingerprint(this.binding.route)
        )
          throw new Error('Unconfirmed model host response');
        return result.response;
      },
      ...(this.binding.policy.protocol === 'native'
        ? {
            continue: async (request, response, results, signal) =>
              this.rpc.call('continue', { request, response, results }, signal) as Promise<
                typeof request
              >,
          }
        : {}),
    };
  }
  receive(reply: RuntimeModelRpcReply): void {
    this.rpc.receive(
      reply.type === 'model-rpc-text'
        ? { ...reply, type: 'runtime-rpc-progress' }
        : { ...reply, type: 'runtime-rpc-result' },
    );
  }
  close(): void {
    this.lifetime.abort();
    this.rpc.close();
  }
}
