import { z } from 'zod';
import type { CredentialPort } from '@skaro/timeline';
import type { ConnectorCredential } from './connector-auth.ts';
import type { ModelFetch } from './model-get.ts';
import { nativeCatalog, nativeModelStream } from './native-transport.ts';
import { OpenAIResponsesStream } from './openai-stream.ts';
import { modelParameters, requireDirectProfile, sampling } from './direct-request.ts';
import {
  requireSameRoute,
  requireToolResults,
  type NativeRequest,
  type NativeResponse,
  type NativeToolResult,
} from './native-types.ts';

const parameters = z.strictObject({
  max_output_tokens: z.number().int().min(1).max(131_072).default(1024),
  ...sampling,
  reasoning_effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
});
export function openAIParameters(value: unknown) {
  return modelParameters(parameters, value);
}
export function openAIResponsesBody(request: NativeRequest): Record<string, unknown> {
  requireDirectProfile(request.route, 'openai', 'openai.responses');
  const { reasoning_effort, ...options } = openAIParameters(request.route.parameters);
  if (!request.input.length) throw new Error('Native model input is empty');
  return {
    model: request.route.modelId,
    ...options,
    input: request.input,
    ...(request.system ? { instructions: request.system } : {}),
    ...(reasoning_effort ? { reasoning: { effort: reasoning_effort } } : {}),
    ...(request.tools?.length
      ? { tools: request.tools.map((tool) => ({ type: 'function', ...tool, strict: false })) }
      : {}),
    stream: true,
    store: false,
    truncation: 'disabled',
    include: ['reasoning.encrypted_content'],
  };
}

/** Pending direct profile; actual account/model verification is required before product admission. */
export class OpenAIResponsesConnector {
  private readonly credentials: CredentialPort;
  private readonly auth: ConnectorCredential;
  private readonly load?: ModelFetch;
  constructor(credentials: CredentialPort, auth: ConnectorCredential, load?: ModelFetch) {
    this.credentials = credentials;
    this.auth = structuredClone(auth);
    this.load = load;
  }
  complete(
    input: NativeRequest,
    signal: AbortSignal,
    onText?: (text: string) => void,
  ): Promise<NativeResponse> {
    const request = structuredClone(input);
    return nativeModelStream({
      credentials: this.credentials,
      load: this.load,
      auth: this.auth,
      route: request.route,
      path: 'responses',
      authentication: 'bearer',
      body: openAIResponsesBody(request),
      stream: new OpenAIResponsesStream(request.route),
      signal,
      onText,
    });
  }
  catalog(signal: AbortSignal) {
    return nativeCatalog(this.credentials, this.auth, 'bearer', signal, this.load);
  }
  continue(
    request: NativeRequest,
    response: NativeResponse,
    results: readonly NativeToolResult[],
  ): NativeRequest {
    requireSameRoute(request, response);
    requireToolResults(response.calls, results);
    const items = response.calls.map((call) => {
      const result = results.find((result) => result.id === call.id)!;
      return {
        type: 'function_call_output',
        call_id: call.id,
        output: result.isError ? JSON.stringify({ error: result.text }) : result.text,
      };
    });
    return structuredClone({ ...request, input: [...request.input, ...response.output, ...items] });
  }
}
