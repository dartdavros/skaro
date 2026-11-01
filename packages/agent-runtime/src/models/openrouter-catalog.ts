import { z } from 'zod';
import type { Model } from '@skaro/timeline';

const text = z.string().min(1).max(512);
const count = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional();
const entry = z.object({
  id: text.regex(/^[^\p{Cc}\s]+$/u),
  name: text.optional(),
  context_length: count,
  architecture: z
    .object({ input_modalities: z.array(text).max(32).optional() })
    .nullable()
    .optional(),
  top_provider: z
    .object({ context_length: count, max_completion_tokens: count })
    .nullable()
    .optional(),
  supported_parameters: z.array(text).max(256).optional(),
  pricing: z.record(z.string(), z.unknown()).nullable().optional(),
});

export interface OpenRouterCatalogEntry extends Model {
  name: string;
  supportedParameters: string[];
  /** Service-advertised USD per token/request; null is unknown, never a free price. */
  pricing: { prompt: string | null; completion: string | null; request: string | null };
}

/** Only documented catalogue claims. No manufacturer inference or account/profile verification. */
export function parseOpenRouterCatalog(
  raw: unknown,
  connectionId: string,
): OpenRouterCatalogEntry[] {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(connectionId)) throw new Error('Invalid catalog connection');
  const parsed = z.array(entry).max(10_000).safeParse(raw);
  if (!parsed.success) throw new Error('Invalid OpenRouter model catalog');
  const ids = new Set<string>();
  const price = (value: unknown) =>
    typeof value === 'string' &&
    value.length <= 80 &&
    /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0
      ? value
      : null;
  return parsed.data.map((item) => {
    if (ids.has(item.id)) throw new Error('Ambiguous OpenRouter model identity');
    ids.add(item.id);
    const parameters = item.supported_parameters ?? [];
    const supports = (name: string) => (parameters.includes(name) ? 'supported' : 'unknown');
    const contexts = [item.context_length, item.top_provider?.context_length].filter(
      (value): value is number => typeof value === 'number',
    );
    return {
      connectionId,
      id: item.id,
      name: item.name ?? item.id,
      manufacturer: null,
      family: null,
      supportedParameters: parameters,
      pricing: {
        prompt: price(item.pricing?.prompt),
        completion: price(item.pricing?.completion),
        request: price(item.pricing?.request),
      },
      capabilities: {
        tools: supports('tools'),
        images: item.architecture?.input_modalities?.includes('image') ? 'supported' : 'unknown',
        reasoning: parameters.some((name) => ['reasoning', 'reasoning_effort'].includes(name))
          ? 'supported'
          : 'unknown',
        parallelTools: supports('parallel_tool_calls'),
        cache: 'unknown',
        continuation: 'unknown',
        compaction: 'unknown',
        contextTokens: contexts.length ? Math.min(...contexts) : null,
        outputTokens: item.top_provider?.max_completion_tokens ?? null,
        evidence: 'catalog',
      },
    };
  });
}
