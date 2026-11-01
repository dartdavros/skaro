import { z } from 'zod';
import { validateModelEndpoint } from '@skaro/timeline';
import type { ChatRequest } from './chat-types.ts';

const parameters = z.strictObject({
  max_tokens: z.number().int().min(1).max(8192).default(1024),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  reasoning_effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
});
export function openRouterParameters(value: unknown) {
  const parsed = parameters.safeParse(value);
  if (!parsed.success) throw new Error('Unsupported or invalid OpenRouter model parameters');
  return parsed.data;
}

export function openRouterBody(input: ChatRequest): Record<string, unknown> {
  const route = input.route;
  validateModelEndpoint(route.endpoint);
  if (
    route.connector !== 'openrouter' ||
    route.apiProfile.id !== 'openrouter.chat-completions' ||
    route.apiProfile.revision !== 1
  )
    throw new Error('Unsupported OpenRouter API profile');
  const optionsWithReasoning = openRouterParameters(route.parameters);
  const upstream = route.upstream;
  if (
    !['restricted', 'service-default'].includes(upstream.selection) ||
    !Array.isArray(upstream.allow) ||
    upstream.allow.some((id) => typeof id !== 'string' || !id.trim()) ||
    (upstream.selection === 'restricted') !== upstream.allow.length > 0 ||
    typeof upstream.allowFallback !== 'boolean' ||
    typeof upstream.requireParameters !== 'boolean' ||
    !['deny', 'allow'].includes(upstream.dataCollection)
  )
    throw new Error('Invalid upstream policy');
  if (
    !route.modelId ||
    !Number.isFinite(input.price.prompt) ||
    !Number.isFinite(input.price.completion) ||
    input.price.prompt < 0 ||
    input.price.completion < 0
  )
    throw new Error('Invalid request price ceiling');
  if (
    !input.messages.length ||
    input.messages.some(
      (message) => !['system', 'user', 'assistant', 'tool'].includes(message.role),
    )
  )
    throw new Error('Invalid model messages');
  const { reasoning_effort, ...options } = optionsWithReasoning;
  if (
    input.price.request !== undefined &&
    (!Number.isFinite(input.price.request) || input.price.request < 0)
  )
    throw new Error('Invalid request fee ceiling');
  return {
    model: route.modelId,
    ...options,
    messages: input.messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(reasoning_effort ? { reasoning: { effort: reasoning_effort } } : {}),
    ...(input.tools?.length
      ? {
          tools: input.tools.map((tool) => ({ type: 'function', function: tool })),
          tool_choice: input.toolChoice ?? 'auto',
        }
      : {}),
    provider: {
      ...(upstream.selection === 'restricted' ? { only: upstream.allow } : {}),
      allow_fallbacks: upstream.allowFallback,
      require_parameters: upstream.requireParameters,
      data_collection: upstream.dataCollection,
      max_price: input.price,
    },
  };
}
