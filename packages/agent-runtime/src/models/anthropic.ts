import { z } from 'zod';
import type { CredentialPort } from '@skaro/timeline';
import type { ConnectorCredential } from './connector-auth.ts';
import { nativeCatalog, nativeModelStream } from './native-transport.ts';
import { AnthropicMessagesStream } from './anthropic-stream.ts';
import { modelParameters, requireDirectProfile } from './direct-request.ts';
import {
  requireSameRoute,
  requireToolResults,
  type NativeRequest,
  type NativeResponse,
  type NativeToolResult,
} from './native-types.ts';

const parameters = z.strictObject({
  max_tokens: z.number().int().min(1).max(131_072).default(1024),
  temperature: z.number().min(0).max(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  thinking: z.enum(['disabled', 'enabled', 'adaptive']).optional(),
  thinking_budget_tokens: z.number().int().min(1024).max(131_071).optional(),
  effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
});
export function anthropicMessagesBody(request: NativeRequest): Record<string, unknown> {
  requireDirectProfile(request.route, 'anthropic', 'anthropic.messages');
  const { thinking, thinking_budget_tokens, effort, ...options } = modelParameters(
    parameters,
    request.route.parameters,
  );
  if (
    !request.input.length ||
    request.input.some((message) => !['user', 'assistant'].includes(String(message.role)))
  )
    throw new Error('Invalid native Anthropic messages');
  if (
    (thinking === 'enabled') !== (thinking_budget_tokens !== undefined) ||
    (thinking_budget_tokens !== undefined && thinking_budget_tokens >= options.max_tokens)
  )
    throw new Error('Anthropic thinking requires an explicit budget below max_tokens');
  if (
    thinking &&
    thinking !== 'disabled' &&
    (options.temperature !== undefined || options.top_p !== undefined)
  )
    throw new Error('Sampling parameters are not admitted with Anthropic thinking');
  return {
    model: request.route.modelId,
    ...options,
    messages: request.input,
    stream: true,
    ...(request.system ? { system: request.system } : {}),
    ...(thinking
      ? {
          thinking: {
            type: thinking,
            ...(thinking_budget_tokens !== undefined
              ? { budget_tokens: thinking_budget_tokens }
              : {}),
          },
        }
      : {}),
    ...(effort ? { output_config: { effort } } : {}),
    ...(request.tools?.length
      ? {
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters,
          })),
        }
      : {}),
  };
}
export class AnthropicMessagesConnector {
  private readonly credentials: CredentialPort;
  private readonly auth: ConnectorCredential;
  constructor(credentials: CredentialPort, auth: ConnectorCredential) {
    this.credentials = credentials;
    this.auth = structuredClone(auth);
  }
  complete(
    input: NativeRequest,
    signal: AbortSignal,
    onText?: (text: string) => void,
  ): Promise<NativeResponse> {
    const request = structuredClone(input);
    return nativeModelStream({
      credentials: this.credentials,
      auth: this.auth,
      route: request.route,
      path: 'messages',
      authentication: 'anthropic',
      body: anthropicMessagesBody(request),
      stream: new AnthropicMessagesStream(request.route),
      signal,
      onText,
    });
  }
  catalog(signal: AbortSignal) {
    return nativeCatalog(this.credentials, this.auth, 'anthropic', signal);
  }
  continue(
    request: NativeRequest,
    response: NativeResponse,
    results: readonly NativeToolResult[],
  ): NativeRequest {
    requireSameRoute(request, response);
    requireToolResults(response.calls, results);
    return structuredClone({
      ...request,
      input: [
        ...request.input,
        { role: 'assistant', content: response.output },
        {
          role: 'user',
          content: response.calls.map((call) => {
            const result = results.find((result) => result.id === call.id)!;
            return {
              type: 'tool_result',
              tool_use_id: call.id,
              content: result.text,
              ...(result.isError ? { is_error: true } : {}),
            };
          }),
        },
      ],
    });
  }
}
