import { z } from 'zod';
import type { RouteSnapshot, RuntimeModelRequest } from '@skaro/timeline';
import type { ModelCatalogEntry } from './catalog-entry.ts';
import { isDeepStrictEqual } from 'node:util';
import { openAIParameters } from './openai.ts';
import { anthropicParameters } from './anthropic.ts';
import { deepSeekParameters } from './deepseek.ts';
import { catalogEfforts, effortParameter } from './catalog-effort.ts';

const label = z.string().min(1).max(512);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional();
const support = z.object({ supported: z.boolean() }).passthrough().nullable().optional();
const entry = z.object({
  id: label.regex(/^[^\p{Cc}\s]+$/u),
  name: label.optional(),
  display_name: label.optional(),
  line: label.nullable().optional(),
  lifecycle: z.enum(['active', 'deprecated', 'retired']).optional(),
  max_input_tokens: count,
  max_tokens: count,
  context_window: count,
  max_output_tokens: count,
  input_modalities: z.array(label).max(32).optional(),
  effort: z
    .object({ supported_levels: z.array(label).max(32), default_level: label.optional() })
    .optional(),
  capabilities: z
    .object({ image_input: support, thinking: support, effort: support })
    .passthrough()
    .nullable()
    .optional(),
});
export type DirectCatalogProfile = 'openai' | 'anthropic' | 'deepseek';

export function parseDirectCatalog(
  raw: unknown,
  connectionId: string,
  profile: DirectCatalogProfile,
): ModelCatalogEntry[] {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(connectionId)) throw new Error('Invalid catalog connection');
  const items = z.array(entry).max(10000).parse(raw),
    ids = new Set<string>();
  const number = (value: number | null | undefined) => (value && value > 0 ? value : null);
  return items
    .filter((item) => item.lifecycle !== 'retired')
    .map((item) => {
      if (ids.has(item.id)) throw new Error('Ambiguous direct model identity');
      ids.add(item.id);
      const advertised = item.capabilities;
      const capability = (value: { supported: boolean } | null | undefined) =>
        value
          ? value.supported
            ? ('supported' as const)
            : ('unsupported' as const)
          : ('unknown' as const);
      const efforts =
        profile === 'deepseek'
          ? item.effort?.supported_levels
          : profile === 'anthropic' && advertised?.effort?.supported
            ? Object.entries(advertised.effort)
                .filter(
                  ([name, value]) =>
                    name !== 'supported' &&
                    typeof value === 'object' &&
                    value !== null &&
                    (value as { supported?: boolean }).supported === true,
                )
                .map(([name]) => name)
            : undefined;
      return {
        connectionId,
        id: item.id,
        name: item.display_name ?? item.name ?? item.id,
        manufacturer: null,
        family: item.line ?? null,
        supportedParameters: [],
        pricing: { prompt: null, completion: null, request: null },
        ...(efforts
          ? {
              reasoning: {
                supportedEfforts: efforts,
                ...(item.effort?.default_level ? { defaultEffort: item.effort.default_level } : {}),
              },
            }
          : {}),
        capabilities: {
          tools: 'unknown',
          images:
            profile === 'anthropic'
              ? capability(advertised?.image_input)
              : item.input_modalities
                ? item.input_modalities.includes('image')
                  ? 'supported'
                  : 'unsupported'
                : 'unknown',
          reasoning:
            profile === 'anthropic'
              ? capability(advertised?.thinking)
              : efforts?.length
                ? 'supported'
                : 'unknown',
          parallelTools: 'unknown',
          cache: 'unknown',
          continuation: 'unknown',
          compaction: 'unknown',
          contextTokens: number(item.max_input_tokens ?? item.context_window),
          outputTokens: number(item.max_tokens ?? item.max_output_tokens),
          evidence: 'catalog',
        },
      };
    });
}

/** Membership and connector schema only. The list API cannot prove inference/tool readiness. */
export function requireDirectCatalogRoute(
  route: RouteSnapshot,
  models: readonly ModelCatalogEntry[],
  request?: RuntimeModelRequest,
) {
  const profiles = {
    openai: 'openai.responses',
    anthropic: 'anthropic.messages',
    deepseek: 'deepseek.chat-completions',
  };
  if (
    !(route.connector in profiles) ||
    route.apiProfile.revision !== 1 ||
    profiles[route.connector as DirectCatalogProfile] !== route.apiProfile.id
  )
    throw new Error('Unsupported direct catalog profile');
  const matches = models.filter(
    (model) => model.connectionId === route.connectionId && model.id === route.modelId,
  );
  if (matches.length !== 1 || matches[0]!.capabilities.evidence !== 'catalog')
    throw new Error('Configured direct model is absent or ambiguous in catalog');
  const model = matches[0]!;
  const effort = route.parameters[effortParameter(route.connector)];
  if (
    effort !== undefined &&
    model.reasoning?.supportedEfforts !== undefined &&
    !catalogEfforts(route.connector, model).includes(String(effort))
  )
    throw new Error('Selected effort is absent from direct catalog metadata');
  const parameters =
    route.connector === 'openai'
      ? openAIParameters(route.parameters)
      : route.connector === 'anthropic'
        ? anthropicParameters(route.parameters)
        : deepSeekParameters(route.parameters);
  const output = Number(
    'max_output_tokens' in parameters ? parameters.max_output_tokens : parameters.max_tokens,
  );
  if (model.capabilities.outputTokens !== null && output > model.capabilities.outputTokens)
    throw new Error('Model output ceiling exceeds the advertised limit');
  if (
    request &&
    (request.kind !== (route.connector === 'deepseek' ? 'chat' : 'native') ||
      !isDeepStrictEqual(request.value.route, route))
  )
    throw new Error('Direct catalog request differs from its route');
  return structuredClone(model);
}
