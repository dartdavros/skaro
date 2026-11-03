import type { ModelCatalogEntry } from './catalog-entry.ts';
import { openRouterEfforts } from './openrouter-effort.ts';

export function effortParameter(connector: string): 'effort' | 'reasoning_effort' {
  return connector === 'anthropic' ? 'effort' : 'reasoning_effort';
}

/** Intersect explicit metadata with the connector's wire values; unknown stays unknown. */
export function catalogEfforts(
  connector: string,
  model?: Pick<ModelCatalogEntry, 'reasoning'>,
): string[] {
  if (connector === 'openrouter') return openRouterEfforts(model);
  const advertised = model?.reasoning?.supportedEfforts;
  if (!advertised) return [];
  const wire =
    connector === 'anthropic'
      ? ['low', 'medium', 'high', 'max']
      : connector === 'deepseek'
        ? ['none', 'low', 'high', 'max']
        : connector === 'openai'
          ? ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
          : [];
  return wire.filter((value) => advertised.includes(value));
}
