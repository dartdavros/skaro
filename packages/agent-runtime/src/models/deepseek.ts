import { z } from 'zod';
import type { CredentialPort } from '@skaro/timeline';
import type { ConnectorCredential } from './connector-auth.ts';
import type { ChatMessage, ChatRequest, ChatResponse } from './chat-types.ts';
import type { NativeToolResult } from './native-types.ts';
import { nativeCatalog, nativeModelStream } from './native-transport.ts';
import { ChatCompletionStream } from './chat-stream.ts';
import { nativeObject, nativeTokens } from './native-values.ts';
import { modelParameters, requireDirectProfile, sampling } from './direct-request.ts';

export type DeepSeekRequest = Omit<ChatRequest, 'price'>;
const parameters = z.strictObject({
  max_tokens: z.number().int().min(1).max(393_216).default(1024),
  ...sampling,
  thinking: z.enum(['enabled', 'disabled']).optional(),
  reasoning_effort: z.enum(['none', 'low', 'high', 'max']).optional(),
});
export function deepSeekBody(request: DeepSeekRequest): Record<string, unknown> {
  requireDirectProfile(request.route, 'deepseek', 'deepseek.chat-completions');
  const { thinking, ...options } = modelParameters(parameters, request.route.parameters);
  if (
    !request.messages.length ||
    request.messages.some(
      (message) => message.reasoning !== undefined || message.reasoning_details !== undefined,
    )
  )
    throw new Error('Gateway reasoning cannot enter a direct DeepSeek conversation');
  if (
    (options.temperature !== undefined || options.top_p !== undefined) &&
    thinking !== 'disabled' &&
    options.reasoning_effort !== 'none'
  )
    throw new Error('DeepSeek sampling requires explicitly disabled thinking');
  if (
    thinking &&
    options.reasoning_effort &&
    (thinking === 'disabled') !== (options.reasoning_effort === 'none')
  )
    throw new Error('Conflicting DeepSeek thinking parameters');
  return {
    model: request.route.modelId,
    messages: request.messages,
    ...options,
    ...(thinking ? { thinking: { type: thinking } } : {}),
    ...(request.tools?.length
      ? {
          tools: request.tools.map((tool) => ({ type: 'function', function: tool })),
          tool_choice: request.toolChoice ?? 'auto',
        }
      : {}),
    stream: true,
    stream_options: { include_usage: true },
  };
}
class DeepSeekStream {
  readonly complete = false; // The transport requires the literal [DONE] marker.
  private readonly stream = new ChatCompletionStream();
  private readonly route: DeepSeekRequest['route'];
  constructor(route: DeepSeekRequest['route']) {
    this.route = structuredClone(route);
  }
  push(value: unknown): string {
    const chunk = nativeObject(value);
    const output = this.stream.push(value);
    const choices = chunk.choices as { delta?: Record<string, unknown> }[];
    if (
      choices.some(
        (choice) =>
          choice.delta?.reasoning_details !== undefined || choice.delta?.reasoning !== undefined,
      )
    )
      throw new Error('Unsupported native DeepSeek reasoning delta');
    if (chunk.usage)
      this.stream.usage.cachedTokens = nativeTokens(
        nativeObject(chunk.usage).prompt_cache_hit_tokens,
      );
    return output;
  }
  snapshot(): unknown {
    return { native: this.stream.native, message: this.stream.message };
  }
  finish(requestId: string | null): ChatResponse {
    const finishReason = this.stream.requireComplete();
    return {
      message: structuredClone(this.stream.message),
      native: structuredClone(this.stream.native),
      finishReason,
      provenance: {
        route: this.route,
        actualModel: this.stream.actualModel,
        upstream: null,
        requestId: requestId ?? this.stream.requestId,
        usage: { ...this.stream.usage, cost: null },
      },
    };
  }
}

export class DeepSeekChatConnector {
  private readonly credentials: CredentialPort;
  private readonly auth: ConnectorCredential;
  constructor(credentials: CredentialPort, auth: ConnectorCredential) {
    this.credentials = credentials;
    this.auth = structuredClone(auth);
  }
  complete(
    input: DeepSeekRequest,
    signal: AbortSignal,
    onText?: (text: string) => void,
  ): Promise<ChatResponse> {
    const request = structuredClone(input);
    return nativeModelStream({
      credentials: this.credentials,
      auth: this.auth,
      route: request.route,
      path: 'chat/completions',
      authentication: 'bearer',
      body: deepSeekBody(request),
      stream: new DeepSeekStream(request.route),
      doneMarker: true,
      signal,
      onText,
    });
  }
  catalog(signal: AbortSignal) {
    return nativeCatalog(this.credentials, this.auth, 'bearer', signal);
  }
  continue(
    request: DeepSeekRequest,
    response: ChatResponse,
    results: readonly NativeToolResult[],
  ): DeepSeekRequest {
    if (JSON.stringify(request.route) !== JSON.stringify(response.provenance.route))
      throw new Error('Native continuation cannot cross routes');
    const calls = response.message.tool_calls ?? [];
    if (
      !calls.length ||
      results.length !== calls.length ||
      new Set(results.map((result) => result.id)).size !== results.length ||
      results.some((result) => !calls.some((call) => call.id === result.id))
    )
      throw new Error('Native tool result identities do not match the response');
    const messages: ChatMessage[] = calls.map((call) => {
      const result = results.find((result) => result.id === call.id)!;
      return {
        role: 'tool',
        tool_call_id: call.id,
        content: result.isError ? JSON.stringify({ error: result.text }) : result.text,
      };
    });
    // All prior reasoning_content is retained, including turns without tool calls.
    return structuredClone({
      ...request,
      messages: [...request.messages, response.message, ...messages],
    });
  }
}
