import type { RouteSnapshot, RuntimeModelRequest } from '@skaro/timeline';
import { isDeepStrictEqual } from 'node:util';
import type { OpenRouterCatalogEntry } from './openrouter-catalog.ts';
import { openRouterParameters } from './openrouter-request.ts';
import { openRouterEfforts } from './openrouter-effort.ts';

/** Advertised metadata check only; never upgrades catalog evidence to verified readiness. */
export function requireOpenRouterCatalogRoute(
  route: RouteSnapshot,
  models: readonly OpenRouterCatalogEntry[],
  request?: RuntimeModelRequest,
) {
  if (
    route.connector !== 'openrouter' ||
    route.apiProfile.id !== 'openrouter.chat-completions' ||
    route.apiProfile.revision !== 1
  )
    throw new Error('Catalog route check is not implemented for this API profile');
  const matching = models.filter(
    (model) => model.connectionId === route.connectionId && model.id === route.modelId,
  );
  if (matching.length !== 1) throw new Error('Configured model is absent or ambiguous in catalog');
  const model = matching[0]!;
  if (model.capabilities.evidence !== 'catalog')
    throw new Error('Model metadata has no catalog provenance');
  const parameters = openRouterParameters(route.parameters);
  // OpenRouter documents these output-limit names with the same semantics.
  // This is an API alias, not inference from a model/manufacturer name.
  const aliases: Record<string, readonly string[]> = {
    max_tokens: ['max_tokens', 'max_completion_tokens'],
    reasoning_effort: ['reasoning', 'reasoning_effort'],
  };
  for (const name of Object.keys(parameters)) {
    const names = aliases[name] ?? [name];
    if (
      !names.some((value) => model.supportedParameters.includes(value)) &&
      !(name === 'reasoning_effort' && model.reasoning)
    )
      throw new Error(`Model parameter is not advertised in catalog: ${name}`);
  }
  const { outputTokens, contextTokens } = model.capabilities;
  if (
    parameters.reasoning_effort !== undefined &&
    !openRouterEfforts(model).includes(parameters.reasoning_effort)
  )
    throw new Error('Model reasoning effort is not advertised in catalog');
  if (
    (outputTokens !== null && parameters.max_tokens > outputTokens) ||
    (contextTokens !== null && parameters.max_tokens > contextTokens)
  )
    throw new Error('Model output ceiling exceeds its advertised token limits');
  if (request) {
    if (request.kind !== 'chat' || !isDeepStrictEqual(request.value.route, route))
      throw new Error('Catalog request differs from the configured route');
    if (
      request.value.tools?.length &&
      (model.capabilities.tools !== 'supported' ||
        !model.supportedParameters.includes('tools') ||
        !model.supportedParameters.includes('tool_choice'))
    )
      throw new Error('Model tools are not advertised in catalog');
  }
  return structuredClone(model);
}
