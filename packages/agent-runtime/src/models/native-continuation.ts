import { requireDirectProfile } from './direct-request.ts';
import { requireSameRoute, requireToolResults } from './native-types.ts';
import type { NativeRequest, NativeResponse, NativeToolResult } from './native-types.ts';

/** Preserve provider-native blocks/items. This pure formatter neither grants nor repeats an effect. */
export function continueNativeConversation(
  request: NativeRequest,
  response: NativeResponse,
  results: readonly NativeToolResult[] = [],
): NativeRequest {
  requireSameRoute(request, response);
  if (response.calls.length) requireToolResults(response.calls, results);
  else if (results.length) throw new Error('Terminal native response has no tool calls');
  const openAI = request.route.apiProfile.id === 'openai.responses';
  requireDirectProfile(
    request.route,
    openAI ? 'openai' : 'anthropic',
    openAI ? 'openai.responses' : 'anthropic.messages',
  );
  if (openAI) {
    const output = response.calls.map((call) => {
      const result = results.find((result) => result.id === call.id)!;
      return {
        type: 'function_call_output',
        call_id: call.id,
        output: result.isError ? JSON.stringify({ error: result.text }) : result.text,
      };
    });
    return structuredClone({
      ...request,
      input: [...request.input, ...response.output, ...output],
    });
  }
  return structuredClone({
    ...request,
    input: [
      ...request.input,
      { role: 'assistant', content: response.output },
      ...(response.calls.length
        ? [
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
          ]
        : []),
    ],
  });
}
